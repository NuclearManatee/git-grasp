import { existsSync, readFileSync } from 'node:fs';
import { verifyFileChecksum } from '../lib/checksum.js';
import { defaultDbPath, userPaths, packageDataDir } from '../lib/paths.js';
import { configFilePath, readConfig } from '../lib/config.js';
import path from 'node:path';

export function doctor() {
  const lines = [];
  let ok = true;
  const dbPath = defaultDbPath();
  const dbCheck = verifyFileChecksum(dbPath);
  if (!dbCheck.ok) {
    ok = false;
    lines.push(`DB: FAIL (${dbCheck.reason}) at ${dbPath}`);
    lines.push('  Fix: run npm run build-catalog && npm run seed');
  } else {
    lines.push(`DB: OK (${dbCheck.hash.slice(0, 12)}…)`);
    lines.push('  Schema v2 required (example/intent_family/simplicity_rank). If search fails: npm run seed');
  }

  const modelDir = path.join(userPaths().cache, 'models');
  const bundled = path.join(packageDataDir(), 'models');
  const hasModel = existsSync(modelDir) || existsSync(bundled) || process.env.GIT_HELP_MOCK_EMBEDDINGS === '1';
  if (!hasModel) {
    ok = false;
    lines.push('Model: MISSING — run npm install (postinstall) or set GIT_HELP_MOCK_EMBEDDINGS=1 for tests');
  } else {
    lines.push('Model: OK (cache, bundle, or mock)');
  }

  try {
    const cfg = readConfig();
    lines.push(`Config: OK (skillLevel=${cfg.skillLevel == null ? 'off' : cfg.skillLevel}) at ${configFilePath()}`);
  } catch (e) {
    ok = false;
    lines.push(`Config: FAIL — ${e.message}`);
  }

  try {
    JSON.parse(readFileSync(new URL('../../config/thresholds.json', import.meta.url), 'utf8'));
    lines.push('Thresholds: OK');
  } catch {
    ok = false;
    lines.push('Thresholds: FAIL');
  }

  return { ok, lines };
}
