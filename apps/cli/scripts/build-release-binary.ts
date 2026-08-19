#!/usr/bin/env bun
// @ts-nocheck
/**
 * Build a release zip: compiled binary + common/data/ + common/config/thresholds.json.
 *
 * Usage:
 *   bun run build:release
 *   bun run build:release -- --out-dir=./dist-release
 *
 * Asset name (no version — stable for releases/latest/download):
 *   git-grasp-linux-x64.zip | git-grasp-darwin-arm64.zip | git-grasp-windows-x64.zip
 */

import { mkdirSync, cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACKAGE_ROOT, defaultDbPath, defaultThresholdsPath, catalogDir } from '../../../common/src/lib/paths.js';

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

/** macOS Bun builds disable extension loading unless we ship a vanilla libsqlite3. */
function findDarwinSqliteLib() {
  const candidates = [
    process.env.GIT_GRASP_SQLITE_LIB,
    '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib',
    '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
    '/usr/local/opt/sqlite3/lib/libsqlite3.dylib',
  ].filter(Boolean);
  const brew = spawnSync('brew', ['--prefix', 'sqlite'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (brew.status === 0) {
    const prefix = brew.stdout.trim();
    if (prefix) candidates.unshift(path.join(prefix, 'lib', 'libsqlite3.dylib'));
  }
  for (const lib of candidates) {
    if (lib && existsSync(lib)) return lib;
  }
  return null;
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
const packageJsonPath = path.join(PACKAGE_ROOT, 'package.json');
const recipesLatestPath = path.join(catalogDir(), 'recipes.latest.json');

if (!existsSync(dbPath)) {
  console.error(`Missing ${dbPath}. Run bun run ship first.`);
  process.exit(1);
}
if (!existsSync(dbSha)) {
  console.error(`Missing ${dbSha}. Seed must write a checksum — refuse to ship without integrity.`);
  process.exit(1);
}
if (!existsSync(thresholdsPath)) {
  console.error(`Missing ${thresholdsPath}`);
  process.exit(1);
}
if (!existsSync(packageJsonPath)) {
  console.error(`Missing ${packageJsonPath}`);
  process.exit(1);
}
if (!existsSync(recipesLatestPath)) {
  console.error(`Missing ${recipesLatestPath}`);
  process.exit(1);
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
mkdirSync(path.join(stageDir, 'common', 'data', 'catalog'), { recursive: true });
mkdirSync(path.join(stageDir, 'common', 'config'), { recursive: true });

const entry = path.join(PACKAGE_ROOT, 'apps', 'cli', 'bin', 'index.ts');
const outfile = path.join(stageDir, binName);

console.log(`Compiling ${entry} → ${outfile}`);
const compile = spawnSync(
  'bun',
  ['build', '--compile', entry, `--outfile=${outfile}`],
  { stdio: 'inherit', cwd: PACKAGE_ROOT, shell: process.platform === 'win32' },
);
if (compile.status !== 0) {
  console.error('bun build --compile failed');
  process.exit(compile.status ?? 1);
}

cpSync(packageJsonPath, path.join(stageDir, 'package.json'));
cpSync(dbPath, path.join(stageDir, 'common', 'data', 'git-commands.db'));
cpSync(dbSha, path.join(stageDir, 'common', 'data', 'git-commands.db.sha256'));
cpSync(recipesLatestPath, path.join(stageDir, 'common', 'data', 'catalog', 'recipes.latest.json'));
cpSync(thresholdsPath, path.join(stageDir, 'common', 'config', 'thresholds.json'));

if (slug.startsWith('darwin-')) {
  const sqliteLib = findDarwinSqliteLib();
  if (!sqliteLib) {
    console.error(
      'darwin release requires libsqlite3.dylib with extension loading '
      + '(brew install sqlite, or set GIT_GRASP_SQLITE_LIB).',
    );
    process.exit(1);
  }
  const libDir = path.join(stageDir, 'common', 'lib');
  mkdirSync(libDir, { recursive: true });
  cpSync(sqliteLib, path.join(libDir, 'libsqlite3.dylib'));
  console.log(`Bundled ${sqliteLib} → common/lib/libsqlite3.dylib`);
}

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });

console.log(`Zipping → ${zipPath}`);
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
    console.error('zip command failed — install zip, or re-run on a runner with zip');
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
