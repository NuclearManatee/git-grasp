import { createHash } from 'node:crypto';
import { EMBEDDING_DIM } from '../db/constants.js';

/**
 * Bag-of-words style mock embedding so overlapping tokens rank closer (CI without HF).
 */
export function mockEmbed(text) {
  const out = new Float32Array(EMBEDDING_DIM);
  const tokens = String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) tokens.push('empty');
  for (const tok of tokens) {
    const hash = createHash('sha256').update(tok).digest();
    for (let i = 0; i < EMBEDDING_DIM; i += 1) {
      out[i] += ((hash[i % hash.length] / 255) * 2 - 1) / tokens.length;
    }
  }
  let norm = 0;
  for (let i = 0; i < out.length; i += 1) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

let pipelinePromise = null;

export async function getEmbedder({ forceMock = false } = {}) {
  if (forceMock || process.env.GIT_HELP_MOCK_EMBEDDINGS === '1') {
    return {
      embed: async (text) => mockEmbed(text),
      mock: true,
    };
  }
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        dtype: 'fp32',
      });
      return {
        mock: false,
        embed: async (text) => {
          const output = await extractor(text, { pooling: 'mean', normalize: true });
          const data = output.data ?? output;
          return data instanceof Float32Array ? data : new Float32Array(data);
        },
      };
    })();
  }
  return pipelinePromise;
}
