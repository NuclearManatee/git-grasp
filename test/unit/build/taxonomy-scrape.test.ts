import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseGitHelpAll,
  buildGitCommandsTaxonomy,
  taxonomyEmbedText,
  TAXONOMY_SECTION_NAMES,
} from '../../../packages/core/src/build/taxonomyScrape.ts';
import { loadGitCommandTaxonomy } from '../../../packages/core/src/build/prepare.ts';
import { gitCommandsTaxonomyPath } from '../../../packages/core/src/lib/paths.ts';

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

  it('buildGitCommandsTaxonomy flattens commands', () => {
    const text = readFileSync(path.join(fixtures, 'git-help-a-sample.txt'), 'utf8');
    const parsed = parseGitHelpAll(text);
    const tax = buildGitCommandsTaxonomy({ sections: parsed.sections, scraped_at: '2026-01-01' });
    expect(tax.version).toBe(1);
    expect(tax.commands.length).toBe(parsed.commands.length);
  });

  it('taxonomyEmbedText uses [command] prefix and optional summary', () => {
    expect(taxonomyEmbedText('git status')).toBe('[command] git status');
    expect(taxonomyEmbedText('git status', 'Show the working tree status')).toBe(
      '[command] git status\nShow the working tree status',
    );
  });

  it('ships checked-in git_commands.json', () => {
    const tax = loadGitCommandTaxonomy(gitCommandsTaxonomyPath());
    expect(tax.sections).toHaveLength(3);
    expect(tax.commands.length).toBeGreaterThan(50);
    expect(tax.commands.some((c) => c.command === 'git status')).toBe(true);
  });
});
