import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseGitHelpAll,
  buildGitCommandsTaxonomy,
  taxonomyEmbedText,
  TAXONOMY_SECTION_NAMES,
  probeGitCommandAvailability,
  isTrustedStandalonePath,
  isUnsignedVerifySkip,
  groundableTaxonomyCommands,
} from '../../../common/src/build/taxonomyScrape.ts';
import { loadGitCommandTaxonomy } from '../../../common/src/build/taxonomyScrape.ts';
import { gitCommandsTaxonomyPath } from '../../../common/src/lib/paths.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/prepare');

describe('taxonomy scrape parse', () => {
  it('keeps first three sections and git <name> ids', () => {
    const text = readFileSync(path.join(fixtures, 'git-help-a-sample.txt'), 'utf8');
    const parsed = parseGitHelpAll(text);
    expect(parsed.sections.map((s) => s.name)).toEqual([...TAXONOMY_SECTION_NAMES]);
    expect(parsed.commands.map((c) => c.command)).toContain('git commit');
    expect(parsed.commands.map((c) => c.command)).toContain('git blame');
    expect(parsed.commands.map((c) => c.command)).not.toContain('git svn');
    expect(parsed.commands.map((c) => c.command)).not.toContain('git cat-file');
    expect(parsed.commands.every((c) => c.command.startsWith('git '))).toBe(true);
  });

  it('buildGitCommandsTaxonomy flattens commands with probe:false defaults', () => {
    const text = readFileSync(path.join(fixtures, 'git-help-a-sample.txt'), 'utf8');
    const parsed = parseGitHelpAll(text);
    const tax = buildGitCommandsTaxonomy({
      sections: parsed.sections,
      scraped_at: '2026-01-01',
      probe: false,
    });
    expect(tax.version).toBe(2);
    expect(tax.commands.length).toBe(parsed.commands.length);
    expect(tax.availability?.total).toBe(tax.commands.length);
    expect(tax.commands.every((c) => c.available === true)).toBe(true);
    expect(tax.commands.every((c) => c.runner === 'git')).toBe(true);
  });

  it('taxonomyEmbedText uses [command] prefix and optional summary', () => {
    expect(taxonomyEmbedText('git status')).toBe('[command] git status');
    expect(taxonomyEmbedText('git status', 'Show the working tree status')).toBe(
      '[command] git status\nShow the working tree status',
    );
  });

  it('ships checked-in git_commands.json with availability', () => {
    const tax = loadGitCommandTaxonomy(gitCommandsTaxonomyPath());
    expect(tax.version).toBe(2);
    expect(tax.sections).toHaveLength(3);
    expect(tax.commands.length).toBeGreaterThan(50);
    expect(tax.commands.some((c) => c.command === 'git status' && c.available)).toBe(true);
    expect(tax.availability).toBeTruthy();
  });
});

describe('probeGitCommandAvailability', () => {
  it('classifies git runner when -h succeeds', () => {
    const p = probeGitCommandAvailability('status', {
      spawnGit: () => ({ status: 129, stdout: '', stderr: 'usage: git status' }),
    });
    expect(p).toMatchObject({ available: true, runner: 'git', command: 'git status' });
  });

  it('classifies standalone when trusted path resolves', () => {
    const p = probeGitCommandAvailability('gitk', {
      spawnGit: () => ({
        status: 1,
        stdout: '',
        stderr: "git: 'gitk' is not a git command",
      }),
      resolveStandalone: () => 'C:\\Program Files\\Git\\cmd\\gitk.exe',
    });
    expect(p).toMatchObject({ available: true, runner: 'standalone', command: 'gitk' });
  });

  it('marks unavailable when both git and standalone miss', () => {
    const p = probeGitCommandAvailability('instaweb', {
      spawnGit: () => ({
        status: 1,
        stdout: '',
        stderr: "git: 'instaweb' is not a git command",
      }),
      resolveStandalone: () => null,
    });
    expect(p.available).toBe(false);
    expect(p.runner).toBe(null);
  });

  it('rejects CiTool System32 false-positive', () => {
    expect(
      isTrustedStandalonePath('C:\\WINDOWS\\system32\\CiTool.exe', 'citool'),
    ).toBe(false);
    const p = probeGitCommandAvailability('citool', {
      spawnGit: () => ({
        status: 1,
        stdout: '',
        stderr: "git: 'citool' is not a git command",
      }),
      resolveStandalone: () => 'C:\\WINDOWS\\system32\\CiTool.exe',
    });
    expect(p.available).toBe(false);
  });
});

describe('groundable / verify skip', () => {
  it('isUnsignedVerifySkip matches verify-*', () => {
    expect(isUnsignedVerifySkip('git verify-commit')).toBe(true);
    expect(isUnsignedVerifySkip('git verify-tag')).toBe(true);
    expect(isUnsignedVerifySkip('git commit')).toBe(false);
  });

  it('groundableTaxonomyCommands drops unavailable and verify', () => {
    const out = groundableTaxonomyCommands({
      commands: [
        { command: 'git status', available: true },
        { command: 'git citool', available: false },
        { command: 'git verify-commit', available: true },
      ],
    });
    expect(out.map((c) => c.command)).toEqual(['git status']);
  });
});
