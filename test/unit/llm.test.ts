// @ts-nocheck
import { describe, it, expect, afterEach } from 'bun:test';
import { z } from 'zod';
import { PROVIDERS, getProvider, resolveProviderId, chatCompletionsUrl } from '../../common/src/lib/providers.js';
import { llmChat, llmJsonObject, llmJson, LlmError, parseJsonLenient, resetLlmRateLimiterForTests } from '../../common/src/lib/llm.js';

describe('providers', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
    resetLlmRateLimiterForTests();
  });

  it('happy: default is deepseek v4 flash', () => {
    delete process.env.GIT_GRASP_LLM_PROVIDER;
    const p = getProvider();
    expect(p.id).toBe('deepseek');
    expect(p.defaultModel).toBe('deepseek-v4-flash');
    expect(p.concurrencyLimit).toBe(2500);
    expect(p.defaultConcurrency).toBe(64);
    expect(chatCompletionsUrl(p)).toBe('https://api.deepseek.com/chat/completions');
  });

  it('positive: deepseek is the only provider', () => {
    expect(Object.keys(PROVIDERS)).toEqual(['deepseek']);
    expect(PROVIDERS.deepseek.envKey).toBe('DEEPSEEK_API_KEY');
  });

  it('negative: unknown provider', () => {
    expect(() => resolveProviderId('nope')).toThrow(/Unknown LLM provider/);
  });

  it('edge: env override deepseek', () => {
    process.env.GIT_GRASP_LLM_PROVIDER = 'DEEPSEEK';
    expect(resolveProviderId()).toBe('deepseek');
  });

  it('negative: groq no longer selectable', () => {
    expect(() => resolveProviderId('groq')).toThrow(/Unknown LLM provider/);
  });
});

describe('llm client', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
    resetLlmRateLimiterForTests();
  });

  it('happy: parses chat content', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.GIT_GRASP_LLM_PROVIDER = 'deepseek';
    const fetchImpl = async (url, init) => {
      expect(url).toContain('api.deepseek.com');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('deepseek-v4-flash');
      expect(body.thinking).toEqual({ type: 'disabled' });
      expect(body.response_format).toEqual({ type: 'json_object' });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    };
    const data = await llmJsonObject({
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl,
      schema: z.object({ ok: z.boolean() }),
    });
    expect(data).toEqual({ ok: true });
  });

  it('positive: extracts JSON from prose', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'Here:\n{"a":1}\n' } }],
      }),
    });
    const data = await llmJsonObject({
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl,
      schema: z.object({ a: z.number() }),
    });
    expect(data.a).toBe(1);
  });

  it('fault: repairs truncated JSON array', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({
        choices: [{ message: { content: '{"commands":[{"command":"git status"},{"command":"git lo' } }],
      }),
    });
    const data = await llmJsonObject({
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl,
      schema: z.object({
        commands: z.array(z.object({ command: z.string() }).passthrough()),
      }),
    });
    expect(Array.isArray(data.commands)).toBe(true);
    expect(data.commands[0].command).toBe('git status');
  });

  it('negative: HTTP error', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchImpl = async () => ({
      ok: false,
      status: 429,
      headers: { get: (h) => (h === 'retry-after' ? '2' : null) },
      text: async () => 'slow down',
    });
    // Bypass limiter so we assert raw LlmError (limiter would retry 429 → RATE_LIMIT_PAUSE).
    await expect(llmChat({
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl,
      skipRateLimit: true,
    })).rejects.toMatchObject({ status: 429, retryAfterMs: 2000, name: 'LlmError' });
  });

  it('fault: empty choices', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ choices: [{}] }),
    });
    await expect(llmChat({
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl,
    })).rejects.toBeInstanceOf(LlmError);
  });

  it('negative: schema fail retries once then throws', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          choices: [{ message: { content: '{"wrong":true}' } }],
        }),
      };
    };
    await expect(llmJsonObject({
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl,
      schema: z.object({ ok: z.boolean() }),
    })).rejects.toMatchObject({ name: 'LlmError' });
    expect(calls).toBe(2);
  });

  it('happy: schema fail then succeeds on retry', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const content = calls === 1 ? '{"wrong":true}' : '{"ok":true}';
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          choices: [{ message: { content } }],
        }),
      };
    };
    const data = await llmJsonObject({
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl,
      schema: z.object({ ok: z.boolean() }),
    });
    expect(data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('edge: missing API key', async () => {
    process.env.DEEPSEEK_API_KEY = '';
    process.env.GIT_GRASP_LLM_PROVIDER = 'deepseek';
    await expect(llmChat({
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl: async () => ({ ok: true }),
    })).rejects.toThrow(/DEEPSEEK_API_KEY/);
  });

  it('positive: global rate limiter caps in-flight llmChat', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.GIT_GRASP_LLM_PROVIDER = 'deepseek';
    process.env.GIT_GRASP_LLM_CONCURRENCY = '2';
    resetLlmRateLimiterForTests();

    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight -= 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
      };
    };

    await Promise.all(
      Array.from({ length: 6 }, () =>
        llmJsonObject({
          messages: [{ role: 'user', content: 'hi' }],
          fetchImpl,
          schema: z.object({ ok: z.boolean() }),
        }),
      ),
    );

    expect(maxInFlight).toBeLessThanOrEqual(2);
    resetLlmRateLimiterForTests();
    delete process.env.GIT_GRASP_LLM_CONCURRENCY;
  });

  it('parseJsonLenient and llmJson schema required', async () => {
    expect(parseJsonLenient('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(() => parseJsonLenient('')).toThrow(/empty JSON/);
    process.env.DEEPSEEK_API_KEY = 'test-key';
    await expect(llmJson({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/Zod schema/);
    process.env.GIT_GRASP_TLS_INSECURE = '1';
    process.env.GIT_GRASP_LLM_TIMEOUT_MS = '30';
    process.env.GIT_GRASP_LLM_FETCH_RETRIES = '1';
    await expect(
      llmChat({
        messages: [{ role: 'user', content: 'x' }],
        skipRateLimit: true,
        fetchImpl: () => new Promise(() => {}),
      }),
    ).rejects.toBeInstanceOf(LlmError);
    delete process.env.GIT_GRASP_TLS_INSECURE;
    delete process.env.GIT_GRASP_LLM_TIMEOUT_MS;
    delete process.env.GIT_GRASP_LLM_FETCH_RETRIES;
  });

  it('retries transient fetch errors then succeeds', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.GIT_GRASP_LLM_FETCH_RETRIES = '3';
    process.env.GIT_GRASP_LLM_NO_RATE_LIMIT = '1';
    process.env.GIT_GRASP_LLM_MAX_TOKENS = '128';
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('fetch failed');
        throw err;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => 'not-json',
      };
    };
    await expect(
      llmChat({
        messages: [{ role: 'user', content: 'x' }],
        skipRateLimit: true,
        fetchImpl,
        thinking: null,
        maxTokens: 64,
      }),
    ).rejects.toMatchObject({ name: 'LlmError' });
    expect(calls).toBe(2);

    let attempt = 0;
    const okAfter = async () => {
      attempt += 1;
      if (attempt === 1) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      };
    };
    const out = await llmChat({
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl: okAfter,
    });
    expect(out.content).toBe('ok');
    expect(parseJsonLenient('{"a":1, "b": "unterm')).toEqual({ a: 1, b: '' });
    delete process.env.GIT_GRASP_LLM_FETCH_RETRIES;
    delete process.env.GIT_GRASP_LLM_NO_RATE_LIMIT;
    delete process.env.GIT_GRASP_LLM_MAX_TOKENS;
  });

  it('hard-timeout wins when fetch ignores abort', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.GIT_GRASP_LLM_TIMEOUT_MS = '20';
    process.env.GIT_GRASP_LLM_FETCH_RETRIES = '1';
    await expect(
      llmChat({
        messages: [{ role: 'user', content: 'x' }],
        skipRateLimit: true,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener?.('abort', () => {
              /* ignore abort so hardTimeout can win */
            });
          }),
      }),
    ).rejects.toBeInstanceOf(LlmError);
    delete process.env.GIT_GRASP_LLM_TIMEOUT_MS;
    delete process.env.GIT_GRASP_LLM_FETCH_RETRIES;
  });
});
