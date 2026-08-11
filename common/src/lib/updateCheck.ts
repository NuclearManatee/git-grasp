// @ts-nocheck
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readConfig, writeConfig } from './config.js';
import { userPaths } from './paths.js';
import { appVersion } from './version.js';
import { warnLine } from '../ux/cliStyle.js';

export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
export const NPM_PACKAGE_NAME = 'git-grasp';
export const DEFAULT_FETCH_TIMEOUT_MS = 2500;

export function updateCachePath() {
  return path.join(userPaths().cache, 'update-check.json');
}

export function isUpdateCheckHardOff(env = process.env) {
  return env.GIT_GRASP_UPDATE_CHECK === '0' || env.GIT_GRASP_UPDATE_CHECK === 'false';
}

export function isUpdateCheckEnabled(cfg = readConfig(), env = process.env) {
  if (isUpdateCheckHardOff(env)) return false;
  return cfg?.updateCheck === true;
}

export function setUpdateCheckEnabled(on) {
  return writeConfig({ updateCheck: Boolean(on) });
}

/**
 * Compare major.minor.patch. Returns 1 if a>b, -1 if a<b, 0 if equal/unparseable tie.
 * Pre-release local (with `-`) is treated as older than the same numeric remote.
 */
export function compareSemver(a, b) {
  const parse = (v) => {
    const s = String(v || '').trim().replace(/^v/i, '');
    const [core, pre] = s.split('-');
    const parts = core.split('.').map((x) => Number.parseInt(x, 10));
    while (parts.length < 3) parts.push(0);
    return {
      parts: parts.slice(0, 3).map((n) => (Number.isFinite(n) ? n : 0)),
      pre: pre || '',
    };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.parts[i] > right.parts[i]) return 1;
    if (left.parts[i] < right.parts[i]) return -1;
  }
  if (!left.pre && right.pre) return 1;
  if (left.pre && !right.pre) return -1;
  return 0;
}

export function readUpdateCache() {
  const file = updateCachePath();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeUpdateCache(data) {
  const file = updateCachePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    checkedAt: data.checkedAt || new Date().toISOString(),
    latest: data.latest ?? null,
    local: data.local ?? appVersion(),
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export function isUpdateCacheFresh(cache, now = Date.now(), ttlMs = UPDATE_CHECK_TTL_MS) {
  if (!cache?.checkedAt) return false;
  const t = Date.parse(cache.checkedAt);
  if (!Number.isFinite(t)) return false;
  return now - t < ttlMs;
}

/**
 * @returns {Promise<string|null>}
 */
export async function fetchNpmLatestVersion({
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  packageName = NPM_PACKAGE_NAME,
} = {}) {
  if (typeof fetchImpl !== 'function') return null;
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const ver = body?.version;
    return ver ? String(ver) : null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ enabled: boolean, local: string, latest: string|null, newer: boolean, cached: boolean, checkedAt: string|null }>}
 */
export async function checkForUpdate({
  force = false,
  fetchImpl,
  timeoutMs,
  cfg = readConfig(),
  env = process.env,
} = {}) {
  const local = appVersion();
  const enabled = isUpdateCheckEnabled(cfg, env);
  const cache = readUpdateCache();

  if (!force && !enabled) {
    return {
      enabled: false,
      local,
      latest: cache?.latest ?? null,
      newer: cache?.latest ? compareSemver(cache.latest, local) > 0 : false,
      cached: Boolean(cache),
      checkedAt: cache?.checkedAt ?? null,
    };
  }

  if (!force && isUpdateCacheFresh(cache)) {
    return {
      enabled,
      local,
      latest: cache.latest ?? null,
      newer: cache.latest ? compareSemver(cache.latest, local) > 0 : false,
      cached: true,
      checkedAt: cache.checkedAt,
    };
  }

  const latest = await fetchNpmLatestVersion({ fetchImpl, timeoutMs });
  if (latest) {
    writeUpdateCache({ latest, local, checkedAt: new Date().toISOString() });
  }
  return {
    enabled,
    local,
    latest,
    newer: latest ? compareSemver(latest, local) > 0 : false,
    cached: false,
    checkedAt: latest ? new Date().toISOString() : cache?.checkedAt ?? null,
  };
}

/**
 * Opt-in notify after search. Never throws.
 * @returns {Promise<{ notified: boolean, result?: object }>}
 */
export async function maybeNotifyUpdate(opts = {}) {
  try {
    const cfg = opts.cfg || readConfig();
    const env = opts.env || process.env;
    if (!opts.force && !isUpdateCheckEnabled(cfg, env)) {
      return { notified: false };
    }
    const result = await checkForUpdate({
      force: Boolean(opts.force),
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
      cfg,
      env,
    });
    if (result.newer && result.latest) {
      const quiet = Boolean(opts.quiet);
      if (!quiet) {
        console.error(
          warnLine(
            `A newer git-grasp is available: ${result.latest} (you have ${result.local}). Update with: bun add -g git-grasp@latest`,
            env,
          ),
        );
      }
      return { notified: true, result };
    }
    return { notified: false, result };
  } catch {
    return { notified: false };
  }
}

export function updateCheckStatusDetail(cfg = readConfig(), env = process.env) {
  const cache = readUpdateCache();
  const enabled = isUpdateCheckEnabled(cfg, env);
  return {
    enabled,
    updateCheck: cfg.updateCheck ?? null,
    hardOff: isUpdateCheckHardOff(env),
    label: enabled ? 'on' : 'off',
    local: appVersion(),
    latest: cache?.latest ?? null,
    checkedAt: cache?.checkedAt ?? null,
    cachePath: updateCachePath(),
  };
}
