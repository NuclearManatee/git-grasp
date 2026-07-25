import { requireGroqKey } from './env.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL = 'openai/gpt-oss-120b';

export class GroqError extends Error {
  constructor(message, { status, retryAfterMs, body } = {}) {
    super(message);
    this.name = 'GroqError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.body = body;
  }
}

/**
 * @param {{ messages: Array<{role:string,content:string}>, temperature?: number, responseFormat?: object }} opts
 */
export async function groqChat({
  messages,
  temperature = 0.2,
  responseFormat = null,
  apiKey = null,
  fetchImpl = globalThis.fetch,
}) {
  const key = apiKey ?? requireGroqKey();
  const body = {
    model: GROQ_MODEL,
    messages,
    temperature,
  };
  if (responseFormat) body.response_format = responseFormat;

  const res = await fetchImpl(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const retryAfter = res.headers.get('retry-after');
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
  const text = await res.text();
  if (!res.ok) {
    throw new GroqError(`Groq HTTP ${res.status}`, {
      status: res.status,
      retryAfterMs,
      body: text.slice(0, 500),
    });
  }
  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new GroqError('Empty Groq response', { status: 200, body: text.slice(0, 200) });
  return { content, raw: json };
}

export async function groqJson(opts) {
  const { content } = await groqChat({
    ...opts,
    responseFormat: { type: 'json_object' },
  });
  return JSON.parse(content);
}
