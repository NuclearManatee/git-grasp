// @ts-nocheck
import path from 'node:path';
import { PACKAGE_ROOT } from '../../lib/paths.js';

/** Pinned upstream sources for recipe generation (fetched into gitignored cache). */
export const SOURCE_PINS = Object.freeze({
  cheatSheet: {
    url: 'https://git-scm.com/docs/giteveryday',
    /** Public PDF cheat sheet is layout-only; giteveryday is the structural everyday reference. */
    altUrl: 'https://github.com/git/git-scm.com/raw/main/public/images/cheat-sheets/GitCheatSheet_Page1.jpg',
    label: 'giteveryday',
  },
  tldr: {
    /** Raw pages for git porcelain from tldr-pages (MIT). */
    baseUrl: 'https://raw.githubusercontent.com/tldr-pages/tldr/main/pages/common',
    repoArchive: 'https://codeload.github.com/tldr-pages/tldr/tar.gz/main',
    label: 'tldr-pages',
  },
  progit: {
    repoArchive: 'https://codeload.github.com/progit/progit2/tar.gz/main',
    label: 'progit2',
  },
  gitScmDocs: {
    host: 'git-scm.com',
    label: 'git-scm-docs',
  },
});

export function sourcesCacheDir(root = PACKAGE_ROOT) {
  return path.join(root, 'local', 'cache', 'sources');
}

export function cheatSheetCachePath(root = PACKAGE_ROOT) {
  return path.join(sourcesCacheDir(root), 'cheat-sheet');
}

export function tldrCachePath(root = PACKAGE_ROOT) {
  return path.join(sourcesCacheDir(root), 'tldr');
}

export function progitCachePath(root = PACKAGE_ROOT) {
  return path.join(sourcesCacheDir(root), 'progit');
}

export function manOracleCachePath(root = PACKAGE_ROOT) {
  return path.join(sourcesCacheDir(root), 'man-oracle.json');
}
