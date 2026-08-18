import { describe, expect, it } from 'bun:test';
import { COMMANDS, FLAGS, completionScript } from '../../common/src/lib/completion.ts';

describe('completionScript', () => {
  it('emits scripts for supported shells', () => {
    expect(completionScript('bash')).toContain('_git_grasp');
    expect(completionScript('zsh')).toContain('#compdef git-grasp');
    expect(completionScript('fish')).toContain('complete -c git-grasp');
    expect(completionScript('powershell')).toContain('Register-ArgumentCompleter');
    expect(completionScript('pwsh')).toContain('Register-ArgumentCompleter');
    expect(COMMANDS).toContain('search');
    expect(FLAGS).toContain('--json');
  });

  it('rejects unknown shells', () => {
    expect(() => completionScript('cmd')).toThrow(/Unsupported shell/);
  });
});
