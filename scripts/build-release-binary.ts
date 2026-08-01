#!/usr/bin/env bun
// @ts-nocheck
/**
 * Build a release zip: compiled binary + data/ + config/thresholds.json.
 *
 * Usage:
 *   bun scripts/build-release-binary.ts
 *   bun scripts/build-release-binary.ts --out-dir=./dist-release
 *
 * Asset name (no version ÔÇö stable for releases/latest/download):
 *   git-grasp-linux-x64.zip | git-grasp-darwin-arm64.zip | git-grasp-windows-x64.zip
 */

import { mkdirSync, cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACKAGE_ROOT, defaultDbPath, defaultThresholdsPath } from '../packages/core/src/lib/paths.js';

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

function platformSlug() {
  const os = process.platform === 'win32' ? 'windows'
    : process.platform === 'darwin' ? 'darwin'
      : process.platform === 'linux' ? 'linux'
        : process.platform;
  const arch = process.arch === 'x64' || process.arch === 'arm64'
    ? process.arch
    : process.arch;
  return `${os}-${arch}`;
}

const outDir = path.resolve(argValue('--out-dir', path.join(PACKAGE_ROOT, 'dist-release')));
const slug = argValue('--platform', platformSlug());
const stageDir = path.join(outDir, `stage-${slug}`);
const binName = process.platform === 'win32' ? 'git-grasp.exe' : 'git-grasp';
const zipName = `git-grasp-${slug}.zip`;
const zipPath = path.join(outDir, zipName);

const dbPath = defaultDbPath();
const thresholdsPath = defaultThresholdsPath();
const dbSha = `${dbPath}.sha256`;

if (!existsSync(dbPath)) {
  console.error(`Missing ${dbPath}. Run bun run seed first.`);
  process.exit(1);
}
if (!existsSync(thresholdsPath)) {
  console.error(`Missing ${thresholdsPath}`);
  process.exit(1);
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
mkdirSync(path.join(stageDir, 'data'), { recursive: true });
mkdirSync(path.join(stageDir, 'config'), { recursive: true });

const entry = path.join(PACKAGE_ROOT, 'apps', 'cli', 'bin', 'index.ts');
const outfile = path.join(stageDir, binName);

console.log(`Compiling ${entry} ÔåÆ ${outfile}`);
const compile = spawnSync(
  'bun',
  ['build', '--compile', entry, `--outfile=${outfile}`],
  { stdio: 'inherit', cwd: PACKAGE_ROOT, shell: process.platform === 'win32' },
);
if (compile.status !== 0) {
  console.error('bun build --compile failed');
  process.exit(compile.status ?? 1);
}

cpSync(dbPath, path.join(stageDir, 'data', 'git-commands.db'));
if (existsSync(dbSha)) {
  cpSync(dbSha, path.join(stageDir, 'data', 'git-commands.db.sha256'));
}
cpSync(thresholdsPath, path.join(stageDir, 'config', 'thresholds.json'));

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });

console.log(`Zipping ÔåÆ ${zipPath}`);
if (process.platform === 'win32') {
  const ps = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`],
    { stdio: 'inherit' },
  );
  if (ps.status !== 0) process.exit(ps.status ?? 1);
} else {
  const zip = spawnSync('zip', ['-r', zipPath, '.'], { cwd: stageDir, stdio: 'inherit' });
  if (zip.status !== 0) {
    // Fallback: tar.gz if zip missing (still upload as .zip name only if zip works)
    console.error('zip command failed ÔÇö install zip, or re-run on a runner with zip');
    process.exit(zip.status ?? 1);
  }
}

const meta = {
  platform: slug,
  zip: zipName,
  binary: binName,
  createdAt: new Date().toISOString(),
};
writeFileSync(path.join(outDir, `git-grasp-${slug}.json`), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify(meta, null, 2));
console.log(`OK ${zipPath}`);
