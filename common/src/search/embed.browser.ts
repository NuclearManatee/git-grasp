// @ts-nocheck
/**
 * Browser-safe embeddings (no node:fs / node:crypto).
 * Same model id as CLI for parity; mock path for tests / e2e.
 */

import { EMBEDDING_DIM } from '../db/constants.js';
import { EMBEDDING_MODEL_ID, EMBEDDING_MODEL_REVISION } from './embeddingModel.js';

/** Same-origin ONNX runtime for Transformers.js (see embed.browser.ts wasmPaths). */
export const BROWSER_ONNX_WASM_PATH = '/vendor/transformers/';

export const BROWSER_EMBEDDING_MODEL = EMBEDDING_MODEL_ID;
export const BROWSER_EMBEDDING_REVISION = EMBEDDING_MODEL_REVISION;

/**
 * Bag-of-words mock embedding (FNV-1a per token ÔÇö no Node crypto).
 * @param {string} text
 * @returns {Float32Array}
 */
export function mockEmbedBrowser(text) {
  const out = new Float32Array(EMBEDDING_DIM);
  const tokens = String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) tokens.push('empty');
  for (const tok of tokens) {
    const hash = fnv1aBytes(tok);
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

function fnv1aBytes(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = new Uint8Array(32);
  let x = h >>> 0;
  for (let i = 0; i < 32; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = (x >>> 0) & 0xff;
  }
  return out;
}

let pipelinePromise = null;

/**
 * @param {{ forceMock?: boolean, onStatus?: (msg: string) => void }} [opts]
 */
export async function getBrowserEmbedder({ forceMock = false, onStatus = undefined } = {}) {
  if (forceMock) {
    return {
      embed: async (text) => mockEmbedBrowser(text),
      mock: true,
    };
  }
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const model = BROWSER_EMBEDDING_MODEL;
      onStatus?.(`Loading embedding model ${model}@${BROWSER_EMBEDDING_REVISION.slice(0, 7)}…`);
      const { pipeline, env } = await import('@huggingface/transformers');
      env.backends.onnx.wasm.wasmPaths = BROWSER_ONNX_WASM_PATH;
      const extractor = await pipeline('feature-extraction', model, {
        dtype: 'fp32',
        revision: BROWSER_EMBEDDING_REVISION,
      });
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

export function resetBrowserEmbedderForTests() {
  pipelinePromise = null;
}
