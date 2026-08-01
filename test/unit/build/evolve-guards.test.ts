import { describe, it, expect } from 'vitest';
import {
  assertStateMutation,
  assertFlagMutation,
  assertCompositionMutation,
} from '../../../packages/core/src/build/evolveGuards.ts';

const parent = {
  initial_state: 'git commit --allow-empty -m init\n',
  command_recipe: { commands: [{ command: 'git status' }] },
};

describe('evolve guards', () => {
  it('state requires changed initial_state and frozen verbs', () => {
    expect(
      assertStateMutation(parent, {
        initial_state: 'echo x > f\n',
        command_recipe: { commands: [{ command: 'git status' }] },
      }).ok,
    ).toBe(true);
    expect(
      assertStateMutation(parent, {
        initial_state: parent.initial_state,
        command_recipe: { commands: [{ command: 'git status' }] },
      }).ok,
    ).toBe(false);
    expect(
      assertStateMutation(parent, {
        initial_state: 'echo x > f\n',
        command_recipe: { commands: [{ command: 'git log' }] },
      }).ok,
    ).toBe(false);
  });

  it('flag freezes verbs and checks allowlist', () => {
    const allow = { 'git status': new Set(['-s', '--short', '-b']) };
    expect(
      assertFlagMutation(
        parent,
        {
          initial_state: parent.initial_state,
          command_recipe: { commands: [{ command: 'git status -s' }] },
        },
        allow,
      ).ok,
    ).toBe(true);
    expect(
      assertFlagMutation(
        parent,
        {
          initial_state: parent.initial_state,
          command_recipe: { commands: [{ command: 'git log -s' }] },
        },
        allow,
      ).ok,
    ).toBe(false);
    expect(
      assertFlagMutation(
        parent,
        {
          initial_state: parent.initial_state,
          command_recipe: { commands: [{ command: 'git status --invalid' }] },
        },
        allow,
      ).ok,
    ).toBe(false);
  });

  it('composition inserts within cap and requires -h', () => {
    const fetchHelp = (cmd) =>
      cmd === 'git branch' || cmd === 'git status'
        ? { ok: true, text: 'usage', metadata_source: 'x' }
        : { ok: false, text: '', metadata_source: 'x' };
    expect(
      assertCompositionMutation(
        parent,
        {
          initial_state: parent.initial_state,
          command_recipe: {
            commands: [{ command: 'git status' }, { command: 'git branch' }],
          },
        },
        { fetchHelp },
      ).ok,
    ).toBe(true);
    expect(
      assertCompositionMutation(
        parent,
        {
          initial_state: parent.initial_state,
          command_recipe: {
            commands: [{ command: 'git status' }, { command: 'git notacommand' }],
          },
        },
        { fetchHelp },
      ).ok,
    ).toBe(false);
    const full = {
      ...parent,
      command_recipe: {
        commands: Array.from({ length: 7 }, () => ({ command: 'git status' })),
      },
    };
    expect(
      assertCompositionMutation(
        full,
        {
          initial_state: parent.initial_state,
          command_recipe: {
            commands: [
              ...full.command_recipe.commands,
              { command: 'git log' },
            ],
          },
        },
        { fetchHelp },
      ).ok,
    ).toBe(false);
  });
});
