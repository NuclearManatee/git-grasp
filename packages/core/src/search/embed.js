import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { EMBEDDING_DIM } from '../db/constants.js';
import { PACKAGE_ROOT } from '../lib/paths.js';
import { embeddingModelId, isEmbeddingModelCached } from './modelReady.js';

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

/**
 * @param {{ forceMock?: boolean, onStatus?: (msg: string) => void }} [opts]
 */
export async function getEmbedder({ forceMock = false, onStatus = undefined } = {}) {
  if (forceMock || process.env.GIT_HELP_MOCK_EMBEDDINGS === '1') {
    return {
      embed: async (text) => mockEmbed(text),
      mock: true,
    };
  }
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const cached = isEmbeddingModelCached();
      const model = embeddingModelId();
      if (!cached) {
        onStatus?.(`Downloading embedding model ${model} (one-time)…`);
      } else {
        onStatus?.('Loading embedding model…');
      }
      const { pipeline, env } = await import('@huggingface/transformers');
      // Prefer package-local cache (Docker bake + offline bench).
      const localCache = path.join(
        PACKAGE_ROOT,
        'node_modules',
        '@huggingface',
        'transformers',
        '.cache',
      );
      if (existsSync(localCache)) {
        env.cacheDir = localCache;
      }
      if (cached) {
        env.allowRemoteModels = false;
      }
      let extractor;
      try {
        extractor = await pipeline('feature-extraction', model, {
          dtype: 'fp32',
          local_files_only: cached,
        });
      } catch (err) {
        if (!cached) throw err;
        onStatus?.(`Local model cache incomplete; downloading ${model}…`);
        env.allowRemoteModels = true;
        extractor = await pipeline('feature-extraction', model, {
          dtype: 'fp32',
          local_files_only: false,
        });
      }
      onStatus?.('Embedding model ready');
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

/** Reset lazy embedder (tests / bench isolation). */
export function resetEmbedderForTests() {
  pipelinePromise = null;
}

export { isEmbeddingModelCached, embeddingModelId };
