// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  verifyFileChecksum,
  defaultDbPath,
  userPaths,
  packageDataDir,
  defaultThresholdsPath,
  readConfig,
  configFilePath,
  smokeTestSqliteVec,
  SCHEMA_VERSION,
  PACKAGE_ROOT,
} from '@git-grasp/common/cli';

export function doctor() {
  const lines = [];
  let ok = true;

  const bunVersion = typeof Bun !== 'undefined' ? Bun.version : null;
  if (bunVersion) {
    lines.push(`Runtime: Bun ${bunVersion}`);
  } else {
    ok = false;
    lines.push('Runtime: FAIL ÔÇö Bun is required (bun:sqlite + sqlite-vec)');
  }

  const vec = smokeTestSqliteVec();
  if (!vec.ok) {
    ok = false;
    lines.push(`sqlite-vec: FAIL (${vec.reason})`);
    lines.push('  Fix: bun install (postinstall must resolve platform natives)');
  } else {
    lines.push(`sqlite-vec: OK (vec_version=${vec.version})`);
  }

  const dbPath = defaultDbPath();
  const dbCheck = verifyFileChecksum(dbPath);
  if (!dbCheck.ok) {
    ok = false;
    lines.push(`DB: FAIL (${dbCheck.reason}) at ${dbPath}`);
    lines.push('  Fix: bun run rebuild && bun run seed');
  } else {
    lines.push(`DB: OK (${dbCheck.hash.slice(0, 12)}ÔÇª) schema v${SCHEMA_VERSION}`);
    lines.push(`  Path: ${dbPath}`);
  }

  const modelDir = path.join(userPaths().cache, 'models');
  const bundled = path.join(packageDataDir(), 'models');
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const hfCandidates = [
    process.env.HF_HOME,
    process.env.TRANSFORMERS_CACHE,
    path.join(home, '.cache', 'huggingface'),
    path.join(home, '.cache', 'huggingface', 'hub'),
    path.join(process.env.LOCALAPPDATA || '', 'huggingface'),
  ].filter(Boolean);
  const hasModel = existsSync(modelDir)
    || existsSync(bundled)
    || existsSync(path.join(PACKAGE_ROOT, 'node_modules', '@huggingface', 'transformers', '.cache'))
    || hfCandidates.some((p) => existsSync(p))
    || process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1';
  if (!hasModel) {
    ok = false;
    lines.push(`Model: MISSING — first real search downloads Xenova/bge-small-en-v1.5, or set GIT_GRASP_MOCK_EMBEDDINGS=1`);
  } else if (process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1') {
    lines.push('Model: OK (mock embeddings)');
  } else {
    lines.push('Model: OK (cache, bundle, or Hugging Face cache)');
  }

  try {
    const cfg = readConfig();
    const skill = cfg.skillLevel == null ? 'off' : cfg.skillLevel;
    const tel = cfg.telemetry === true ? 'on' : 'off';
    const invite = cfg.telemetryInvite || 'pending';
    lines.push(
      `Config: OK (skillLevel=${skill}, telemetry=${tel}, invite=${invite}) at ${configFilePath()}`,
    );
  } catch (e) {
    ok = false;
    lines.push(`Config: FAIL — ${e.message}`);
  }

  try {
    JSON.parse(readFileSync(defaultThresholdsPath(), 'utf8'));
    lines.push(`Thresholds: OK (${path.relative(PACKAGE_ROOT, defaultThresholdsPath()) || 'common/config/thresholds.json'})`);
  } catch {
    ok = false;
    lines.push('Thresholds: FAIL');
  }

  return { ok, lines };
}
