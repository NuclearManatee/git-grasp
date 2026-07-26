import { requireProviderKey } from './env.js';
import { getProvider, chatCompletionsUrl } from './providers.js';

export class LlmError extends Error {
  constructor(message, { status, retryAfterMs, body, provider } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.body = body;
    this.provider = provider;
  }
}

function resolveTimeoutMs() {
  return Number(process.env.GIT_HELP_LLM_TIMEOUT_MS || 90_000);
}

function resolveMaxTokens() {
  return Number(process.env.GIT_HELP_LLM_MAX_TOKENS || 4096);
}

/**
 * OpenAI-compatible chat completion against the configured provider.
 */
export async function llmChat({
  messages,
  temperature = 0.2,
  responseFormat = null,
  apiKey = null,
  provider: providerOpt = null,
  model = null,
  thinking = undefined,
  fetchImpl = globalThis.fetch,
  maxTokens = null,
} = {}) {
  if (process.env.GIT_HELP_TLS_INSECURE === '1') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const provider = getProvider(providerOpt);
  const key = apiKey ?? requireProviderKey(provider.id);
  const timeoutMs = resolveTimeoutMs();

  const body = {
    model: model || process.env.GIT_HELP_LLM_MODEL || provider.defaultModel,
    messages,
    temperature,
    max_tokens: maxTokens ?? resolveMaxTokens(),
  };
  if (responseFormat) body.response_format = responseFormat;

  const thinkingCfg = thinking === undefined ? provider.defaultThinking : thinking;
  if (thinkingCfg) body.thinking = thinkingCfg;

  const url = chatCompletionsUrl(provider);

  let res;
  let text;
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
    const hardTimeout = new Promise((_, reject) => {
      setTimeout(() => {
        const e = new Error(`${provider.name} timeout after ${timeoutMs}ms`);
        e.code = 'LLM_TIMEOUT';
        reject(e);
      }, timeoutMs + 1000);
    });
    const raced = await Promise.race([work, hardTimeout]);
    res = raced.response;
    text = raced.textBody;
  } catch (err) {
    const wrapped = new LlmError(`fetch failed: ${err.cause?.message || err.message}`, {
      status: 0,
      body: String(err.cause?.code || err.code || ''),
      provider: provider.id,
    });
    wrapped.cause = err;
    wrapped.code = err.code || wrapped.code;
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

  let json;
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
  return { content, raw: json, provider: provider.id, model: body.model };
}

/**
 * Best-effort JSON object parse for truncated model output.
 */
export function parseJsonLenient(content) {
  const text = String(content ?? '').trim();
  if (!text) throw new SyntaxError('empty JSON');

  const attempts = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) attempts.push(fence[1].trim());
  const brace = text.match(/\{[\s\S]*/);
  if (brace) attempts.push(brace[0]);

  let lastErr;
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

function repairTruncatedJson(raw) {
  let s = String(raw).trim();
  // Drop trailing incomplete string fragment after last safe boundary
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

export async function llmJson(opts) {
  const { content, ...rest } = await llmChat({
    ...opts,
    responseFormat: { type: 'json_object' },
  });
  try {
    return { ...rest, data: parseJsonLenient(content), content };
  } catch (err) {
    throw new LlmError('LLM returned non-JSON content', {
      status: 200,
      body: String(content).slice(0, 300),
      provider: rest.provider,
    });
  }
}

/** Convenience: parse and return only the JSON object. */
export async function llmJsonObject(opts) {
  const { data } = await llmJson(opts);
  return data;
}
