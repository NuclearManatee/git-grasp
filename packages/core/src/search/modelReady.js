import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, packageDataDir, userPaths } from '../lib/paths.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/**
 * Heuristic: is the MiniLM cache likely already on disk?
 * (transformers may still download shards if incomplete.)
 */
export function isEmbeddingModelCached() {
  if (process.env.GIT_HELP_MOCK_EMBEDDINGS === '1') return true;

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const needle = MODEL_ID.replace('/', '--');
  const xfCache = path.join(
    PACKAGE_ROOT,
    'node_modules',
    '@huggingface',
    'transformers',
    '.cache',
  );
  const candidates = [
    path.join(userPaths().cache, 'models'),
    path.join(packageDataDir(), 'models'),
    xfCache,
    path.join(xfCache, `models--${needle}`),
    path.join(PACKAGE_ROOT, 'node_modules', '@huggingface', 'transformers', 'models', 'Xenova', 'all-MiniLM-L6-v2'),
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
      if (existsSync(path.join(root, 'Xenova', 'all-MiniLM-L6-v2'))) return true;
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
