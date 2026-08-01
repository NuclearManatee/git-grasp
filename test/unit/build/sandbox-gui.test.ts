import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isSandboxGuiCommand,
  createSandboxDirs,
  destroySandbox,
  installSandboxShims,
  readShimLog,
  sandboxSpawnEnv,
  guiShimNameForCommand,
  validateInSandbox,
  validateInSandboxAndDestroy,
} from '../../../common/src/build/sandbox.ts';

describe('isSandboxGuiCommand', () => {
  it('classifies gui / citool / gitk / tools', () => {
    expect(isSandboxGuiCommand('git gui')).toBe(true);
    expect(isSandboxGuiCommand('git citool')).toBe(true);
    expect(isSandboxGuiCommand('gitk')).toBe(true);
    expect(isSandboxGuiCommand('git gitk')).toBe(true);
    expect(isSandboxGuiCommand('git difftool')).toBe(true);
    expect(isSandboxGuiCommand('git mergetool')).toBe(true);
    expect(isSandboxGuiCommand('git gitweb')).toBe(true);
  });

  it('allows normal CLI verbs and git help -a', () => {
    expect(isSandboxGuiCommand('git status')).toBe(false);
    expect(isSandboxGuiCommand('git commit -m "x"')).toBe(false);
    expect(isSandboxGuiCommand('git rebase -i HEAD~3')).toBe(false);
    expect(isSandboxGuiCommand('git help -a')).toBe(false);
  });
});

describe('sandbox PATH shims + EDITOR', () => {
  it('creates shim dir on PATH and platform-appropriate shim files', () => {
    const s = createSandboxDirs({ workerId: 'shim', jobId: 'path' });
    try {
      expect(existsSync(s.shims)).toBe(true);
      const env = sandboxSpawnEnv(s);
      expect(env.PATH?.startsWith(s.shims) || env.Path?.startsWith(s.shims)).toBe(true);
      expect(env.GIT_EDITOR).toBeTruthy();
      expect(env.EDITOR).toBe(env.GIT_EDITOR);
      expect(env.VISUAL).toBe(env.GIT_EDITOR);
      expect(env.GIT_SEQUENCE_EDITOR).toBe(env.GIT_EDITOR);
      const sample = process.platform === 'win32' ? 'git-gui.cmd' : 'git-gui';
      expect(existsSync(path.join(s.shims, sample))).toBe(true);
      const body = readFileSync(path.join(s.shims, sample), 'utf8');
      if (process.platform === 'win32') {
        expect(body).toContain('@echo off');
        expect(body).toContain('exit /b');
      } else {
        expect(body).toContain('#!/bin/sh');
        expect(body).toContain('exit 0');
      }
      expect(existsSync(path.join(s.shims, 'grasp-editor'))).toBe(true);
    } finally {
      destroySandbox(s);
    }
  });

  it('GUI recipe validate succeeds and shim log contains argv', () => {
    const result = validateInSandbox({
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: { commands: [{ command: 'git gui --browse' }] },
      workerId: 'shim',
      jobId: 'gui-log',
    });
    try {
      expect(result.ok).toBe(true);
      const log = readShimLog(result.sandbox);
      expect(log.some((l) => /git-gui/i.test(l) && /--browse/.test(l))).toBe(true);
    } finally {
      destroySandbox(result.sandbox);
    }
  });

  it('shim exit 1 fails command_recipe', () => {
    const result = validateInSandboxAndDestroy({
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: { commands: [{ command: 'git gui' }] },
      shimExitCode: 1,
      workerId: 'shim',
      jobId: 'gui-fail',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('command_recipe');
  });

  it('blockGui still returns sandbox_gui_blocked', () => {
    const result = validateInSandboxAndDestroy({
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: { commands: [{ command: 'git citool' }] },
      blockGui: true,
      workerId: 'shim',
      jobId: 'block',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sandbox_gui_blocked');
  });

  it('parallel sandboxes isolate shim logs', () => {
    const a = createSandboxDirs({ workerId: 'a', jobId: '1' });
    const b = createSandboxDirs({ workerId: 'b', jobId: '2' });
    try {
      expect(a.shimLog).not.toBe(b.shimLog);
      installSandboxShims(a);
      installSandboxShims(b);
      expect(readShimLog(a)).toEqual([]);
      expect(readShimLog(b)).toEqual([]);
    } finally {
      destroySandbox(a);
      destroySandbox(b);
    }
  });

  it('guiShimNameForCommand maps verbs', () => {
    expect(guiShimNameForCommand('git gui')).toBe('git-gui');
    expect(guiShimNameForCommand('gitk')).toBe('gitk');
    expect(guiShimNameForCommand('git difftool')).toBe('grasp-difftool');
    expect(guiShimNameForCommand('git status')).toBe(null);
  });
});
