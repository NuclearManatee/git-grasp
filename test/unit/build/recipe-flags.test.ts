import { describe, expect, it } from 'vitest';
import {
  FLAG_DENYLIST,
  assertFlagsOnCommandLine,
  assertRecipeFlagsAllowed,
} from '../../../common/src/build/recipeFlags.ts';

describe('recipeFlags', () => {
  it('allows bare verb', () => {
    expect(assertFlagsOnCommandLine('git status', new Set())).toEqual({ ok: true });
  });

  it('fail-closed when flags present and allowlist empty', () => {
    const r = assertFlagsOnCommandLine('git status --short', new Set());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('flags_allowlist_empty');
  });

  it('rejects denylisted flag even if allowlisted', () => {
    const allow = new Set(['--i-still-use-this', '--oneline']);
    const r = assertFlagsOnCommandLine('git whatchanged --i-still-use-this', allow);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/flag_denied/);
    expect(FLAG_DENYLIST.has('--i-still-use-this')).toBe(true);
  });

  it('accepts allowlisted flags', () => {
    const allow = new Set(['--short', '-s']);
    expect(assertFlagsOnCommandLine('git status --short', allow)).toEqual({ ok: true });
  });

  it('assertRecipeFlagsAllowed uses injected help', () => {
    const ok = assertRecipeFlagsAllowed(
      { command_recipe: { commands: [{ command: 'git status --short' }] } },
      {
        fetchHelp: () => ({ ok: true, text: 'usage: git status [--short] [-s]' }),
      },
    );
    expect(ok).toEqual({ ok: true });

    const bad = assertRecipeFlagsAllowed(
      { command_recipe: { commands: [{ command: 'git status --nope' }] } },
      {
        fetchHelp: () => ({ ok: true, text: 'usage: git status [--short]' }),
      },
    );
    expect(bad.ok).toBe(false);
  });
});
