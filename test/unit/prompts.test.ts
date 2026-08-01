import { describe, it, expect, beforeEach } from 'vitest';
import {
  promptsDir,
  parseFrontmatter,
  splitRoleSections,
  renderPrompt,
  renderPromptRole,
  loadPromptSource,
  clearPromptCache,
} from '../../packages/core/src/lib/prompts.ts';
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
      threshold: 0.9,
      user_json: '{"query":"status"}',
    });
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].role).toBe('system');
    expect(out.messages[0].content).toMatch(/utility > 0\.9/);
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
