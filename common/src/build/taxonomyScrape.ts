// @ts-nocheck
/**
 * Parse `git help -a` text into Main Porcelain + Ancillary taxonomy.
 * Keeps only the first three sections; stops at "Interacting with Others".
 * Capability probe: help-listed names may not be runnable as `git <name>`.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawnGit } from './gitExec.js';

export const TAXONOMY_SECTION_NAMES = [
  'Main Porcelain Commands',
  'Ancillary Commands / Manipulators',
  'Ancillary Commands / Interrogators',
];

const STOP_SECTION = 'Interacting with Others';

/** Standalone binaries that appear in help but are not always `git <name>`. */
export const STANDALONE_GIT_TOOLS = new Set(['gitk', 'scalar']);

/**
 * @param {string} text raw `git help -a` stdout
 */
export function parseGitHelpAll(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  /** @type {{ name: string, commands: { name: string, summary: string, command: string }[] }[]} */
  const sections = [];
  /** @type {{ name: string, commands: { name: string, summary: string, command: string }[] } | null} */
  let current = null;
  let pastIntro = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (TAXONOMY_SECTION_NAMES.includes(trimmed)) {
      pastIntro = true;
      current = { name: trimmed, commands: [] };
      sections.push(current);
      continue;
    }

    if (trimmed === STOP_SECTION || trimmed.startsWith('Low-level Commands')) {
      break;
    }

    if (!pastIntro || !current) continue;

    const m = trimmed.match(/^([a-z][a-z0-9._-]*)\s{2,}(.+)$/i);
    if (!m) continue;
    const name = m[1];
    const summary = m[2].trim();
    current.commands.push({
      name,
      summary,
      command: `git ${name}`,
    });
  }

  const commands = sections.flatMap((s) =>
    s.commands.map((c) => ({ ...c, section: s.name })),
  );

  return { sections, commands };
}

/**
 * True if a resolved standalone path is a trusted Git-related binary
 * (rejects Windows CiTool.exe false positives for "citool").
 * @param {string} resolvedPath
 * @param {string} name help verb name
 */
export function isTrustedStandalonePath(resolvedPath, name) {
  const p = path.resolve(String(resolvedPath || ''));
  if (!p || !existsSync(p)) return false;
  const lower = p.toLowerCase().replace(/\//g, '\\');
  // Reject System32 / Windows false positives (e.g. CiTool.exe)
  if (lower.includes('\\windows\\system32\\') || lower.includes('\\windows\\syswow64\\')) {
    return false;
  }
  const base = path.basename(p).toLowerCase();
  const want = String(name || '').toLowerCase();
  if (base === want || base === `${want}.exe` || base === `${want}.cmd`) return true;
  // Under a Git install prefix
  if (lower.includes('\\git\\') || lower.includes('/git/')) return true;
  return false;
}

/**
 * Resolve standalone tool on PATH (where/which style).
 * @param {string} name
 * @returns {string|null}
 */
export function resolveStandaloneOnPath(name) {
  if (process.platform === 'win32') {
    const r = spawnSync('where.exe', [name], {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
    });
    const line = String(r.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    return line || null;
  }
  const r = spawnSync('which', [name], { encoding: 'utf8' });
  const line = String(r.stdout || '').trim().split(/\n/)[0];
  return line || null;
}

/**
 * Probe whether a help-listed verb is runnable on this machine.
 * @param {string} name e.g. "status", "scalar", "gitk"
 * @param {{ spawnGit?: typeof spawnGit, resolveStandalone?: typeof resolveStandaloneOnPath }} [deps]
 * @returns {{
 *   name: string,
 *   available: boolean,
 *   runner: 'git'|'standalone'|null,
 *   command: string,
 *   detail?: string,
 * }}
 */
export function probeGitCommandAvailability(name, deps = {}) {
  const callGit = deps.spawnGit || spawnGit;
  const resolveStandalone = deps.resolveStandalone || resolveStandaloneOnPath;
  const n = String(name || '').trim();
  if (!n) {
    return { name: n, available: false, runner: null, command: `git ${n}`, detail: 'empty' };
  }

  const r = callGit([n, '-h'], { timeout: 4000 });
  const err = `${r.stderr || ''}${r.stdout || ''}`;
  const notCmd = /is not a git command/i.test(err);
  if (!notCmd && (r.status === 0 || r.status === 129 || r.status === 259)) {
    return {
      name: n,
      available: true,
      runner: 'git',
      command: `git ${n}`,
    };
  }
  // Timed out / GUI opened without "not a command" → still a git subcommand
  if (!notCmd && (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM' || r.status === null)) {
    return {
      name: n,
      available: true,
      runner: 'git',
      command: `git ${n}`,
      detail: 'gui_or_timeout',
    };
  }

  if (STANDALONE_GIT_TOOLS.has(n) || !notCmd) {
    const standalone = resolveStandalone(n);
    if (standalone && isTrustedStandalonePath(standalone, n)) {
      return {
        name: n,
        available: true,
        runner: 'standalone',
        command: n,
        detail: standalone,
      };
    }
  }

  return {
    name: n,
    available: false,
    runner: null,
    command: `git ${n}`,
    detail: notCmd ? 'not_a_git_command' : `exit_${r.status}`,
  };
}

/**
 * Enrich parsed sections with availability probes.
 * @param {{ name: string, commands: { name: string, summary: string, command: string }[] }[]} sections
 * @param {{ probe?: typeof probeGitCommandAvailability }} [opts]
 */
export function enrichSectionsWithAvailability(sections, opts = {}) {
  const probe = opts.probe || probeGitCommandAvailability;
  return sections.map((sec) => ({
    ...sec,
    commands: sec.commands.map((c) => {
      const p = probe(c.name);
      const detail = portableProbeDetail(p.detail);
      return {
        ...c,
        command: p.command,
        available: p.available,
        runner: p.runner,
        ...(detail ? { probe_detail: detail } : {}),
        // Keep raw absolute detail only when caller asks (local probe report).
        ...(opts.keepRawDetail && p.detail && detail !== p.detail
          ? { probe_detail_raw: p.detail }
          : {}),
      };
    }),
  }));
}

/**
 * Strip absolute machine paths from probe_detail for committed artifacts.
 * @param {string|null|undefined} detail
 */
export function portableProbeDetail(detail) {
  if (detail == null || detail === '') return undefined;
  const s = String(detail);
  if (/^(not_a_git_command|gui_or_timeout|exit_\d+|local_binary|standalone_path)$/.test(s)) {
    return s;
  }
  if (/[\\/]/.test(s) && (/[A-Za-z]:\\|^\//.test(s) || s.includes('Program Files'))) {
    return 'standalone_path';
  }
  return s;
}

/**
 * Drop host-local probe fields from a taxonomy doc (committed write).
 * @param {object} taxonomy
 */
export function stripProbePathsForCommit(taxonomy) {
  const scrubCmd = (c) => {
    const next = { ...c };
    delete next.probe_detail_raw;
    if (next.probe_detail) {
      const d = portableProbeDetail(next.probe_detail);
      if (d) next.probe_detail = d;
      else delete next.probe_detail;
    }
    return next;
  };
  return {
    ...taxonomy,
    sections: (taxonomy.sections || []).map((sec) => ({
      ...sec,
      commands: (sec.commands || []).map(scrubCmd),
    })),
    commands: (taxonomy.commands || []).map(scrubCmd),
  };
}

/**
 * @param {{
 *   sections: ReturnType<typeof parseGitHelpAll>['sections'],
 *   scraped_at?: string,
 *   probe?: boolean | typeof probeGitCommandAvailability,
 * }} opts
 */
export function buildGitCommandsTaxonomy(opts) {
  let { sections } = opts;
  const doProbe = opts.probe !== false;
  if (doProbe) {
    const probeFn = typeof opts.probe === 'function' ? opts.probe : probeGitCommandAvailability;
    sections = enrichSectionsWithAvailability(sections, {
      probe: probeFn,
      keepRawDetail: Boolean(opts.keepRawDetail),
    });
  } else {
    // Default available=true for fixtures that skip probing
    sections = sections.map((sec) => ({
      ...sec,
      commands: sec.commands.map((c) => ({
        ...c,
        available: c.available !== false,
        runner: c.runner || 'git',
      })),
    }));
  }
  const commands = sections.flatMap((s) =>
    s.commands.map((c) => ({ ...c, section: s.name })),
  );
  const available = commands.filter((c) => c.available).length;
  const unavailable = commands.length - available;
  const standalone = commands.filter((c) => c.runner === 'standalone').length;
  return {
    version: 2,
    scraped_at: opts.scraped_at || new Date().toISOString(),
    sections,
    commands,
    availability: { available, unavailable, standalone, total: commands.length },
  };
}

/**
 * Embed text for a taxonomy anchor.
 * @param {string} command e.g. `git commit` or `gitk`
 * @param {string} [summary]
 */
export function taxonomyEmbedText(command, summary = '') {
  const base = `[command] ${command}`;
  const s = (summary || '').trim();
  return s ? `${base}\n${s}` : base;
}

/**
 * Verbs that require signed objects — skip unsigned ground (no GPG fixture in v1).
 * @param {string} command e.g. `git verify-commit`
 */
export function isUnsignedVerifySkip(command) {
  const c = String(command || '').toLowerCase();
  return /\bverify-commit\b/.test(c) || /\bverify-tag\b/.test(c);
}

/**
 * Groundable taxonomy commands (available and not verify-unsigned skips).
 * @param {{ commands?: { command: string, available?: boolean, name?: string }[] }} taxonomy
 */
export function groundableTaxonomyCommands(taxonomy) {
  return (taxonomy.commands || []).filter((c) => {
    if (c.available === false) return false;
    if (isUnsignedVerifySkip(c.command || `git ${c.name}`)) return false;
    return true;
  });
}
