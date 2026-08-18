// @ts-nocheck
import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import {
  resolveUnderRoot,
  PACKAGE_ROOT,
  commonDir,
  packageDataDir,
  localDir,
  defaultDbPath,
  buildCacheDir,
  sourcesCacheRoot,
  modelsCacheDir,
  buildStagingDbPath,
  gitCommandsTaxonomyPath,
  intentMatrixPath,
  goalTaxonomyPath,
  lexiconTrapsPath,
  verbFamiliesPath,
  flagDenylistPath,
  evalProposalRoundsDir,
  evalGateRecoveryDir,
  buildPipelineRunsDir,
  taxonomyDir,
  intentMatrixEvalDir,
  promptsRootDir,
  defaultThresholdsPath,
  catalogDir,
  evalDataDir,
  goldenCasesPath,
  judgeCriteriaPath,
  userPaths,
} from '../../common/src/lib/paths.js';

describe('resolveUnderRoot', () => {
  it('allows nested paths', () => {
    const p = resolveUnderRoot(PACKAGE_ROOT, 'common', 'data', 'git-commands.db');
    expect(p.endsWith(path.join('common', 'data', 'git-commands.db'))).toBe(true);
  });

  it('rejects traversal', () => {
    expect(() => resolveUnderRoot(PACKAGE_ROOT, '..', 'etc', 'passwd')).toThrow(/escapes/);
  });
});

describe('path helpers', () => {
  it('resolves package and local dirs', () => {
    expect(commonDir()).toContain('common');
    expect(packageDataDir()).toContain('data');
    expect(localDir()).toContain('local');
    expect(defaultDbPath()).toContain('git-commands.db');
    expect(buildCacheDir()).toContain('cache');
    expect(sourcesCacheRoot()).toContain('sources');
    expect(modelsCacheDir()).toContain('models');
    expect(buildStagingDbPath()).toContain('staging.db');
    expect(gitCommandsTaxonomyPath()).toContain('git_commands.json');
    expect(intentMatrixPath()).toContain('intent_matrix.json');
    expect(goalTaxonomyPath()).toContain('goal_taxonomy.json');
    expect(lexiconTrapsPath()).toContain('lexicon_traps.json');
    expect(verbFamiliesPath()).toContain('verb_families.json');
    expect(flagDenylistPath()).toContain('flag_denylist.json');
    expect(evalProposalRoundsDir()).toContain('proposal-rounds');
    expect(evalGateRecoveryDir()).toContain('gate-recovery');
    expect(buildPipelineRunsDir()).toContain('build-pipeline');
    expect(taxonomyDir()).toContain('taxonomy');
    expect(intentMatrixEvalDir()).toContain('intent-matrix');
    expect(promptsRootDir()).toContain('prompts');
    expect(defaultThresholdsPath()).toContain('thresholds.json');
    expect(catalogDir()).toContain('catalog');
    expect(evalDataDir()).toContain('eval');
    expect(goldenCasesPath()).toContain('cases.json');
    expect(judgeCriteriaPath()).toContain('criteria.md');
    expect(userPaths().config).toBeTruthy();
  });

  it('honors GIT_GRASP_EVAL_DIR and posix userPaths', () => {
    const prev = process.env.GIT_GRASP_EVAL_DIR;
    process.env.GIT_GRASP_EVAL_DIR = path.join(PACKAGE_ROOT, 'local', 'eval-override');
    expect(evalDataDir()).toContain('eval-override');
    if (prev === undefined) delete process.env.GIT_GRASP_EVAL_DIR;
    else process.env.GIT_GRASP_EVAL_DIR = prev;

    const origPlatform = process.platform;
    const prevXdg = process.env.XDG_CONFIG_HOME;
    const prevXdgCache = process.env.XDG_CACHE_HOME;
    const prevAppData = process.env.APPDATA;
    const prevLocal = process.env.LOCALAPPDATA;
    try {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
      process.env.XDG_CONFIG_HOME = '/tmp/xdg-config';
      process.env.XDG_CACHE_HOME = '/tmp/xdg-cache';
      const p = userPaths('git-grasp');
      expect(p.config.replace(/\\/g, '/')).toContain('xdg-config');

      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
      process.env.APPDATA = 'C:\\Users\\me\\AppData\\Roaming';
      process.env.LOCALAPPDATA = 'C:\\Users\\me\\AppData\\Local';
      const w = userPaths('git-grasp');
      expect(w.config.replace(/\\/g, '/')).toMatch(/AppData\/Roaming/i);
    } finally {
      Object.defineProperty(process, 'platform', { configurable: true, value: origPlatform });
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevXdg;
      if (prevXdgCache === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prevXdgCache;
      if (prevAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = prevAppData;
      if (prevLocal === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = prevLocal;
    }
  });
});
