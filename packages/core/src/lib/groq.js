/**
 * Backward-compatible Groq entrypoints — prefer src/lib/llm.js.
 */
import { llmChat, llmJsonObject, LlmError } from './llm.js';

export const GROQ_MODEL = 'openai/gpt-oss-120b';
export class GroqError extends LlmError {
  constructor(message, opts = {}) {
    super(message, { ...opts, provider: opts.provider || 'groq' });
    this.name = 'GroqError';
  }
}

export async function groqChat(opts) {
  return llmChat({ ...opts, provider: 'groq' });
}

export async function groqJson(opts) {
  return llmJsonObject({ ...opts, provider: 'groq' });
}
