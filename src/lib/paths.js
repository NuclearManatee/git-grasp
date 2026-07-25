import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(__dirname, '../..');

export function packageDataDir() {
  return path.join(PACKAGE_ROOT, 'data');
}

export function defaultDbPath() {
  return path.join(packageDataDir(), 'git-commands.db');
}

export function defaultThresholdsPath() {
  return path.join(PACKAGE_ROOT, 'config', 'thresholds.json');
}

/** XDG / APPDATA style paths without extra dependency */
export function userPaths(appName = 'git-help') {
  const home = homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return {
      config: path.join(appData, appName),
      cache: path.join(local, appName, 'Cache'),
    };
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const xdgCache = process.env.XDG_CACHE_HOME || path.join(home, '.cache');
  return {
    config: path.join(xdgConfig, appName),
    cache: path.join(xdgCache, appName),
  };
}

/**
 * Resolve path under an allowed root; reject traversal.
 */
export function resolveUnderRoot(root, ...parts) {
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, ...parts);
  const rel = path.relative(rootResolved, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes allowed root: ${candidate}`);
  }
  return candidate;
}
