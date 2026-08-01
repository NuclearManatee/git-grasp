// @ts-nocheck
/**
 * Canonical physical-state hash for a git sandbox.
 *
 * Inventory (sorted, then SHA-256):
 * - refs: each ref name â†’ peeled OID
 * - HEAD symbolic or OID
 * - index entries: path â†’ stage + blob OID
 * - tracked worktree files: path â†’ content SHA-256 (regular files only)
 *
 * Excludes: .git/config user identity, timestamps, packed-refs mtime, untracked
 * noise beyond what `git ls-files -c` reports as cached/tracked.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnGit } from './gitExec.js';

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function git(cwd, args) {
  const r = spawnGit(args, { cwd });
  return {
    ok: r.status === 0,
    status: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function listFilesRecursive(root, base = root, out = []) {
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    if (name === '.git') continue;
    const full = path.join(root, name);
    const st = statSync(full);
    if (st.isDirectory()) listFilesRecursive(full, base, out);
    else if (st.isFile()) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

/**
 * @param {string} repoDir working tree with .git
 * @returns {string} hex digest
 */
export function computePhysicalHash(repoDir) {
  const lines = [];

  const head = git(repoDir, ['rev-parse', 'HEAD']);
  if (head.ok) lines.push(`HEAD ${head.stdout.trim()}`);

  const sym = git(repoDir, ['symbolic-ref', '-q', 'HEAD']);
  if (sym.ok) lines.push(`HEAD_SYM ${sym.stdout.trim()}`);

  const refs = git(repoDir, ['for-each-ref', '--format=%(refname) %(objectname)']);
  if (refs.ok) {
    for (const line of refs.stdout.split('\n').filter(Boolean).sort()) {
      lines.push(`REF ${line}`);
    }
  }

  const ls = git(repoDir, ['ls-files', '-s']);
  if (ls.ok) {
    for (const line of ls.stdout.split('\n').filter(Boolean).sort()) {
      lines.push(`INDEX ${line}`);
    }
  }

  const tracked = git(repoDir, ['ls-files', '-c']);
  const paths = tracked.ok
    ? tracked.stdout.split('\n').filter(Boolean).sort()
    : listFilesRecursive(repoDir).sort();

  for (const rel of paths) {
    const full = path.join(repoDir, rel);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    const content = readFileSync(full);
    lines.push(`FILE ${rel} ${sha256Hex(content)}`);
  }

  return sha256Hex(lines.join('\n') + '\n');
}

export { git as gitInRepo };
