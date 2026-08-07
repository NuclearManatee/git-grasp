import { describe, it, expect, beforeEach } from 'vitest';
import {
  promptsDir,
  parseFrontmatter,
  splitRoleSections,
  renderPrompt,
  renderPromptRole,
  loadPromptSource,
  clearPromptCache,
} from '../../common/src/lib/prompts.ts';
import { existsSync } from 'node:fs';
import path from 'node:path';

describe('prompt loader', () => {
  beforeEach(() => {
    clearPromptCache();
  });

  it('resolves prompts directory with inventory files', () => {
    const dir = promptsDir();
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(path.join(dir, 'build', 'judge.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'partials', 'evolve-json-rules.md'))).toBe(true);
  });

  it('parseFrontmatter extracts id and body', () => {
    const { meta, body } = parseFrontmatter('---\nid: build/judge\n---\n## system\nHi\n');
    expect(meta.id).toBe('build/judge');
    expect(body).toContain('## system');
  });

  it('splitRoleSections finds system and user', () => {
    const sections = splitRoleSections('## system\nSys\n\n## user\nUsr\n');
    expect(sections.system).toBe('Sys');
    expect(sections.user).toBe('Usr');
  });

  it('renderPrompt fills mustache vars', () => {
    const out = renderPrompt('build/judge', {
      user_json: '{"query":"status"}',
    });
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].role).toBe('system');
    expect(out.messages[0].content).toMatch(/honest usefulness/i);
    expect(out.messages[0].content).not.toMatch(/utility\s*[>≥]\s*0\.9/);
    expect(out.messages[0].content).toMatch(/abstain/i);
    expect(out.messages[1].role).toBe('user');
    expect(out.messages[1].content).toContain('{"query":"status"}');
  });

  it('renderPrompt includes evolve-json-rules partial', () => {
    const out = renderPrompt('build/evolve-state', {
      user_json: '{}',
    });
    expect(out.messages[0].content).toMatch(/command_recipe MUST be an object/);
    expect(out.messages[0].content).toMatch(/STATE mutation/);
  });

  it('evolve-composition prompt includes filler verbs and flag rules', () => {
    const out = renderPrompt('build/evolve-composition', {
      parent_steps: 1,
      child_steps: 2,
      filler_verbs: 'git status, git log, git diff',
      user_json: '{}',
    });
    const sys = out.messages[0].content;
    expect(sys).toMatch(/git status, git log, git diff/);
    expect(sys).toMatch(/filler verbs/i);
    expect(sys).toMatch(/At most ONE net new flag/i);
    expect(sys).toMatch(/git <verb> -h/);
  });

  it('evolve-flag prompt includes allowlist and one-net-flag rules', () => {
    const out = renderPrompt('build/evolve-flag', {
      allowlists: 'git pull: --rebase --ff-only',
      user_json: '{}',
    });
    const sys = out.messages[0].content;
    expect(sys).toMatch(/git pull: --rebase --ff-only/);
    expect(sys).toMatch(/at most ONE net new flag/i);
    expect(sys).toMatch(/allowlist/i);
  });

  it('propose-eval-rules prompt includes generality guidance', () => {
    const out = renderPrompt('build/propose-eval-rules', {
      taxonomy_verbs: 'git switch',
      summary_json: '{}',
      train_failures_json: '[]',
      existing_traps_json: '[]',
      existing_families_json: '[]',
    });
    const sys = out.messages[0].content;
    expect(sys).toMatch(/literal substring/i);
    expect(sys).toMatch(/Singleton skip/i);
    expect(sys).toMatch(/archive_vs_bundle/);
    expect(sys).toMatch(/existing_families_json/);
    expect(sys).toMatch(/switch to an existing branch/);
  });

  it('rewrite-eval-golden keeps composition multi-action shape', () => {
    const sys = renderPromptRole('build/rewrite-eval-golden', 'system');
    expect(sys).toMatch(/NEVER reduce a multi-action golden/i);
    expect(sys).toMatch(/composition/i);
  });

  it('unknown id throws', () => {
    expect(() => renderPrompt('build/does-not-exist')).toThrow(/Prompt not found/);
  });

  it('loadPromptSource returns raw markdown', () => {
    const src = loadPromptSource('build/vanilla');
    expect(src).toMatch(/id:\s*build\/vanilla/);
    expect(src).toMatch(/## system/);
  });

  it('renderPromptRole returns system text', () => {
    const sys = renderPromptRole('build/vanilla', 'system');
    expect(sys).toMatch(/MINIMUM args\/flags/i);
  });
});
