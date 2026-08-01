import type { z, ZodType } from 'zod';
import { requireProviderKey } from './env.js';
import { getProvider, chatCompletionsUrl } from './providers.js';
import {
  createRateLimiter,
  estimateTokensFromMessages,
} from './rateLimit.js';

export class LlmError extends Error {
  status?: number;
  retryAfterMs?: number;
  body?: string;
  provider?: string;
  code?: string;
  override cause?: unknown;

  constructor(
    message: string,
    {
      status,
      retryAfterMs,
      body,
      provider,
    }: {
      status?: number;
      retryAfterMs?: number;
      body?: string;
      provider?: string;
    } = {},
  ) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.body = body;
    this.provider = provider;
  }
}

function resolveTimeoutMs(): number {
  return Number(process.env.GIT_GRASP_LLM_TIMEOUT_MS || 90_000);
}

function resolveMaxTokens(): number {
  return Number(process.env.GIT_GRASP_LLM_MAX_TOKENS || 4096);
}

/** Lazy singleton global LLM concurrency limiter. */
let llmRateLimiter: ReturnType<typeof createRateLimiter> | null = null;

export function getLlmRateLimiter() {
  if (!llmRateLimiter) {
    llmRateLimiter = createRateLimiter();
  }
  return llmRateLimiter;
}

/** Test helper: drop singleton so next call rebuilds from env. */
export function resetLlmRateLimiterForTests() {
  llmRateLimiter = null;
}

export type ChatMessage = { role: string; content: string };

export type LlmChatOpts = {
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: { type: string } | null;
  apiKey?: string | null;
  provider?: string | null;
  model?: string | null;
  thinking?: unknown;
  fetchImpl?: typeof fetch;
  maxTokens?: number | null;
  /** Skip global concurrency limiter (tests / offline tools). */
  skipRateLimit?: boolean;
};

export async function llmChat(opts: LlmChatOpts) {
  const run = () => llmChatUnthrottled(opts);

  if (opts.skipRateLimit || process.env.GIT_GRASP_LLM_NO_RATE_LIMIT === '1') {
    return run();
  }

  return getLlmRateLimiter().schedule(run, {
    estimatedTokens: estimateTokensFromMessages(opts.messages),
  });
}

async function llmChatUnthrottled({
  messages,
  temperature = 0.2,
  responseFormat = null,
  apiKey = null,
  provider: providerOpt = null,
  model = null,
  thinking = undefined,
  fetchImpl = globalThis.fetch,
  maxTokens = null,
}: LlmChatOpts) {
  if (process.env.GIT_GRASP_TLS_INSECURE === '1') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const provider = getProvider(providerOpt as any);
  const key = apiKey ?? requireProviderKey(provider.id);
  const timeoutMs = resolveTimeoutMs();

  const body: Record<string, unknown> = {
    model: model || process.env.GIT_GRASP_LLM_MODEL || provider.defaultModel,
    messages,
    temperature,
    max_tokens: maxTokens ?? resolveMaxTokens(),
  };
  if (responseFormat) body.response_format = responseFormat;

  const thinkingCfg = thinking === undefined ? provider.defaultThinking : thinking;
  if (thinkingCfg) body.thinking = thinkingCfg;

  const url = chatCompletionsUrl(provider);
  const maxAttempts = Math.max(1, Number(process.env.GIT_GRASP_LLM_FETCH_RETRIES || 3));

  let res: Response | undefined;
  let text: string | undefined;
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const work = (async () => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        try {
          const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: ac.signal,
          });
          const textBody = await response.text();
          return { response, textBody };
        } finally {
          clearTimeout(timer);
        }
      })();
      const hardTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          const e = new Error(`${provider.name} timeout after ${timeoutMs}ms`) as Error & {
            code?: string;
          };
          e.code = 'LLM_TIMEOUT';
          reject(e);
        }, timeoutMs + 1000);
      });
      const raced = await Promise.race([work, hardTimeout]);
      res = raced.response;
      text = raced.textBody;
      lastErr = null;
      break;
    } catch (err: any) {
      lastErr = err;
      const transient =
        err?.name === 'AbortError' ||
        err?.code === 'LLM_TIMEOUT' ||
        /aborted|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(String(err?.message || err));
      if (!transient || attempt >= maxAttempts) {
        const wrapped = new LlmError(`fetch failed: ${err.cause?.message || err.message}`, {
          status: 0,
          body: String(err.cause?.code || err.code || ''),
          provider: provider.id,
        });
        wrapped.cause = err;
        wrapped.code = err.code || wrapped.code;
        throw wrapped;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  if (lastErr || !res || text == null) {
    const err = lastErr || new Error('LLM fetch failed');
    const wrapped = new LlmError(`fetch failed: ${err.cause?.message || err.message}`, {
      status: 0,
      body: String(err.cause?.code || err.code || ''),
      provider: provider.id,
    });
    wrapped.cause = err;
    throw wrapped;
  }

  const retryAfter = res.headers.get('retry-after');
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
  if (!res.ok) {
    throw new LlmError(`${provider.name} HTTP ${res.status}`, {
      status: res.status,
      retryAfterMs,
      body: text.slice(0, 500),
      provider: provider.id,
    });
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LlmError(`${provider.name} returned non-JSON body`, {
      status: res.status,
      body: text.slice(0, 300),
      provider: provider.id,
    });
  }

  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmError(`Empty ${provider.name} response`, {
      status: 200,
      body: text.slice(0, 200),
      provider: provider.id,
    });
  }
  return { content, raw: json, provider: provider.id, model: body.model as string };
}

export function parseJsonLenient(content: unknown): unknown {
  const text = String(content ?? '').trim();
  if (!text) throw new SyntaxError('empty JSON');

  const attempts = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) attempts.push(fence[1]!.trim());
  const brace = text.match(/\{[\s\S]*/);
  if (brace) attempts.push(brace[0]!);

  let lastErr: unknown;
  for (const raw of attempts) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      lastErr = e;
    }
    try {
      return JSON.parse(repairTruncatedJson(raw));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new SyntaxError('JSON parse failed');
}

function repairTruncatedJson(raw: string): string {
  let s = String(raw).trim();
  s = s.replace(/,\s*"[^"]*$/, '');
  s = s.replace(/,\s*\{[^}]*$/, '');
  s = s.replace(/,\s*\[[^\]]*$/, '');
  s = s.replace(/:\s*"[^"]*$/, ': ""');
  s = s.replace(/,\s*$/, '');

  const opens = { '{': 0, '[': 0 };
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') opens['{'] += 1;
    else if (ch === '}') opens['{'] -= 1;
    else if (ch === '[') opens['['] += 1;
    else if (ch === ']') opens['['] -= 1;
  }
  if (inStr) s += '"';
  while (opens['['] > 0) {
    s += ']';
    opens['['] -= 1;
  }
  while (opens['{'] > 0) {
    s += '}';
    opens['{'] -= 1;
  }
  return s;
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

export type LlmJsonOpts<S extends ZodType> = LlmChatOpts & {
  schema: S;
};

export async function llmJson<S extends ZodType>(
  opts: LlmJsonOpts<S>,
): Promise<{ data: z.infer<S>; content: string; raw: unknown; provider: string; model: string }> {
  const { schema, ...chatOpts } = opts;
  if (!schema) {
    throw new LlmError('llmJson requires a Zod schema', { status: 0 });
  }

  let lastContent = '';
  let lastProvider = '';
  let lastIssues = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { content, raw, provider, model } = await llmChat({
      ...chatOpts,
      responseFormat: { type: 'json_object' },
    });
    lastContent = content;
    lastProvider = provider;

    let parsed: unknown;
    try {
      parsed = parseJsonLenient(content);
    } catch {
      lastIssues = 'non-JSON content';
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) {
      return { data: result.data, content, raw, provider, model };
    }
    lastIssues = formatZodIssues(result.error);
  }

  throw new LlmError(`LLM JSON failed schema validation: ${lastIssues}`, {
    status: 200,
    body: String(lastContent).slice(0, 300),
    provider: lastProvider,
  });
}

export async function llmJsonObject<S extends ZodType>(opts: LlmJsonOpts<S>): Promise<z.infer<S>> {
  const { data } = await llmJson(opts);
  return data;
}
