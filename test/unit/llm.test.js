import { describe, it, expect, afterEach } from 'vitest';
import { PROVIDERS, getProvider, resolveProviderId, chatCompletionsUrl } from '../../packages/core/src/lib/providers.js';
import { llmChat, llmJsonObject, LlmError } from '../../packages/core/src/lib/llm.js';

describe('providers', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('happy: default is deepseek v4 pro', () => {
    delete process.env.GIT_HELP_LLM_PROVIDER;
    const p = getProvider();
    expect(p.id).toBe('deepseek');
    expect(p.defaultModel).toBe('deepseek-v4-pro');
    expect(p.concurrencyLimit).toBe(500);
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
    process.env.GIT_HELP_LLM_PROVIDER = 'DEEPSEEK';
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
  });

  it('happy: parses chat content', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.GIT_HELP_LLM_PROVIDER = 'deepseek';
    const fetchImpl = async (url, init) => {
      expect(url).toContain('api.deepseek.com');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('deepseek-v4-pro');
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
    await expect(llmChat({
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl,
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

  it('edge: missing API key', async () => {
    process.env.DEEPSEEK_API_KEY = '';
    process.env.GIT_HELP_LLM_PROVIDER = 'deepseek';
    await expect(llmChat({
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl: async () => ({ ok: true }),
    })).rejects.toThrow(/DEEPSEEK_API_KEY/);
  });
});
