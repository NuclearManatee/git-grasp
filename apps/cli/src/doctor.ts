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
  formatVersionReport,
  collectVersionIdentity,
  getMetaValue,
  openDb,
  doctorPaint,
  telemetryStatusDetail,
} from '@git-grasp/common/cli';

/** Maintainer rebuild tips — not for npm/binary product installs. */
function showMaintainerFix() {
  if (process.env.GIT_GRASP_DEV === '1') return true;
  try {
    const pkgPath = path.join(PACKAGE_ROOT, 'package.json');
    if (!existsSync(pkgPath)) return false;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (!pkg.workspaces) return false;
    // Binary zips may ship root package.json (with workspaces); require source tree.
    return (
      existsSync(path.join(PACKAGE_ROOT, 'common', 'src'))
      || existsSync(path.join(PACKAGE_ROOT, 'apps', 'pipeline'))
    );
  } catch {
    return false;
  }
}

export function doctor() {
  const lines = [];
  const failures = {
    runtime: false,
    vec: false,
    db: false,
    model: false,
    config: false,
    thresholds: false,
  };
  const maintainer = showMaintainerFix();

  lines.push(...formatVersionReport().split('\n'));

  const bunVersion = typeof Bun !== 'undefined' ? Bun.version : null;
  if (bunVersion) {
    lines.push(`Runtime: Bun ${bunVersion}`);
  } else {
    failures.runtime = true;
    lines.push('Runtime: FAIL — Bun is required (bun:sqlite + sqlite-vec)');
  }

  const vec = smokeTestSqliteVec();
  if (!vec.ok) {
    failures.vec = true;
    lines.push(`sqlite-vec: FAIL (${vec.reason})`);
    lines.push(
      maintainer
        ? '  Fix: bun install (postinstall must resolve platform natives)'
        : '  Fix: reinstall git-grasp (npm or release zip) so platform natives are restored',
    );
  } else {
    lines.push(`sqlite-vec: OK (vec_version=${vec.version})`);
  }

  const dbPath = defaultDbPath();
  const dbCheck = verifyFileChecksum(dbPath);
  if (!dbCheck.ok) {
    failures.db = true;
    lines.push(`DB: FAIL (${dbCheck.reason}) at ${dbPath}`);
    lines.push(
      maintainer
        ? '  Fix: bun run rebuild'
        : '  Fix: reinstall git-grasp (npm) or re-download the release zip — catalog DB failed integrity checks',
    );
  } else {
    let corpusMeta = '';
    try {
      const db = openDb(dbPath, { readonly: true });
      try {
        const cv = getMetaValue(db, 'corpus_version');
        if (cv) corpusMeta = ` corpus_meta=v${cv}`;
      } finally {
        db.close();
      }
    } catch {
      /* ignore */
    }
    const id = collectVersionIdentity({ dbPath });
    lines.push(
      `DB: OK (${dbCheck.hash.slice(0, 12)}…) schema v${SCHEMA_VERSION}${corpusMeta || (id.corpusVersion != null ? ` catalog=v${id.corpusVersion}` : '')}`,
    );
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
    failures.model = true;
    lines.push('Model: MISSING — run git-grasp init (or search once) to download Xenova/bge-small-en-v1.5');
  } else if (process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1') {
    lines.push('Model: OK (mock embeddings)');
  } else {
    lines.push('Model: OK (cache, bundle, or Hugging Face cache)');
  }

  try {
    const cfg = readConfig();
    const skill = cfg.skillLevel == null ? 'off' : cfg.skillLevel;
    const telDetail = telemetryStatusDetail(cfg);
    const tel = telDetail.hardOff
      ? `off (hard-off; config=${JSON.stringify(cfg.telemetry)})`
      : telDetail.label;
    const invite = cfg.telemetryInvite || 'pending';
    const upd = cfg.updateCheck === true ? 'on' : 'off';
    lines.push(
      `Config: OK (skillLevel=${skill}, telemetry=${tel}, invite=${invite}, updateCheck=${upd}) at ${configFilePath()}`,
    );
  } catch (e) {
    failures.config = true;
    lines.push(`Config: FAIL — ${e.message}`);
  }

  try {
    JSON.parse(readFileSync(defaultThresholdsPath(), 'utf8'));
    lines.push(`Thresholds: OK (${path.relative(PACKAGE_ROOT, defaultThresholdsPath()) || 'common/config/thresholds.json'})`);
  } catch {
    failures.thresholds = true;
    lines.push('Thresholds: FAIL');
  }

  const ok = !Object.values(failures).some(Boolean);
  return { ok, failures, lines: lines.map(doctorPaint) };
}
