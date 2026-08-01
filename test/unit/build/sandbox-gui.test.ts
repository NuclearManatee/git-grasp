import { describe, it, expect } from 'vitest';
import { isSandboxGuiCommand } from '../../../packages/core/src/build/sandbox.ts';

describe('isSandboxGuiCommand', () => {
  it('blocks gui / citool / gitk / tools', () => {
    expect(isSandboxGuiCommand('git gui')).toBe(true);
    expect(isSandboxGuiCommand('git citool')).toBe(true);
    expect(isSandboxGuiCommand('gitk')).toBe(true);
    expect(isSandboxGuiCommand('git gitk')).toBe(true);
    expect(isSandboxGuiCommand('git difftool')).toBe(true);
    expect(isSandboxGuiCommand('git mergetool')).toBe(true);
    expect(isSandboxGuiCommand('git gitweb')).toBe(true);
  });

  it('allows normal CLI verbs', () => {
    expect(isSandboxGuiCommand('git status')).toBe(false);
    expect(isSandboxGuiCommand('git commit -m "x"')).toBe(false);
    expect(isSandboxGuiCommand('git rebase -i HEAD~3')).toBe(false);
  });
});
