// @ts-nocheck
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, packageDataDir, userPaths, modelsCacheDir } from '../lib/paths.js';
import { EMBEDDING_MODEL_ID, EMBEDDING_MODEL_REVISION } from './embeddingModel.js';

const MODEL_ID = EMBEDDING_MODEL_ID;

/**
 * Heuristic: is the embedding model cache likely already on disk?
 * (transformers may still download shards if incomplete.)
 */
export function isEmbeddingModelCached() {
  if (process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1') return true;

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const needle = MODEL_ID.replace('/', '--');
  const orgName = MODEL_ID.split('/')[0];
  const shortName = MODEL_ID.split('/')[1] || MODEL_ID;
  const xfCache = path.join(
    PACKAGE_ROOT,
    'node_modules',
    '@huggingface',
    'transformers',
    '.cache',
  );
  const candidates = [
    path.join(userPaths().cache, 'models'),
    modelsCacheDir(),
    path.join(packageDataDir(), 'models'),
    xfCache,
    path.join(xfCache, `models--${needle}`),
    path.join(
      PACKAGE_ROOT,
      'node_modules',
      '@huggingface',
      'transformers',
      'models',
      orgName,
      shortName,
    ),
    process.env.HF_HOME,
    process.env.TRANSFORMERS_CACHE,
    path.join(home, '.cache', 'huggingface'),
    path.join(home, '.cache', 'huggingface', 'hub'),
    path.join(process.env.LOCALAPPDATA || '', 'huggingface'),
  ].filter(Boolean);

  for (const root of candidates) {
    if (!existsSync(root)) continue;
    try {
      if (existsSync(path.join(root, `models--${needle}`))) return true;
      if (existsSync(path.join(root, needle))) return true;
      if (existsSync(path.join(root, orgName, shortName))) return true;
      if (existsSync(path.join(root, 'config.json'))) return true;
      if (root === xfCache && readdirSync(root).length > 0) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function embeddingModelId() {
  return MODEL_ID;
}

export function embeddingModelRevision() {
  return EMBEDDING_MODEL_REVISION;
}
