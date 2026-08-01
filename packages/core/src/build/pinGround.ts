/**
 * Thin ground wire-up for canonical_pins.json: inject sketch recipes + seed intents.
 */
import { existsSync, readFileSync } from 'node:fs';
import { canonicalPinsPath } from '../lib/paths.js';
import {
  CanonicalPinsFileSchema,
  type CanonicalPin,
} from '../schemas/taxonomyPins.js';
import { validateCanonicalPin } from './taxonomyPins.js';
import { validateInSandboxAndDestroy } from './sandbox.js';

export type PinGroundStats = {
  pins_total: number;
  pins_attempted: number;
  pins_inserted: number;
  pins_dedup_merged: number;
  pins_skipped: number;
  skip_reasons: Record<string, number>;
  accepted_roles: string[];
};

function verbName(command: string): string {
  const parts = String(command || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts[0] === 'git' && parts[1]) return parts[1]!.toLowerCase();
  return (parts[0] || '').toLowerCase();
}

/** Heuristic sandbox setup so pin sketches have a chance to execute. */
export function initialStateForPin(pin: CanonicalPin): string {
  const v = verbName(pin.verb);
  const init = 'git commit --allow-empty -m init';
  const fileHistory = [
    init,
    'echo hello > f.txt',
    'git add f.txt',
    'git commit -m add-f',
  ].join('\n');
  const multiHistory = [
    init,
    'echo a > f.txt',
    'git add f.txt',
    'git commit -m a',
    'echo b > f.txt',
    'git add f.txt',
    'git commit -m b',
    'echo c > f.txt',
    'git add f.txt',
    'git commit -m c',
  ].join('\n');

  if (['blame', 'annotate', 'grep', 'log', 'show', 'whatchanged', 'shortlog', 'diff'].includes(v)) {
    return fileHistory;
  }
  if (v === 'bisect' || v === 'history' || v === 'filter-branch' || v === 'rebase' || v === 'reflog') {
    return multiHistory;
  }
  if (['push', 'pull', 'fetch', 'remote', 'ls-remote', 'bundle'].includes(v)) {
    return [
      init,
      'git branch -M main',
      'git init --bare $GIT_GRASP_REMOTES/origin.git',
      'git remote add origin $GIT_GRASP_REMOTES/origin.git',
    ].join('\n');
  }
  if (v === 'clone') {
    return ['git init --bare $GIT_GRASP_REMOTES/origin.git'].join('\n');
  }
  if (v === 'checkout' || v === 'switch') {
    return [multiHistory, 'git branch feature-branch'].join('\n');
  }
  if (v === 'commit') {
    return [init, 'echo staged > f.txt', 'git add f.txt'].join('\n');
  }
  if (v === 'am') {
    return [init, 'echo placeholder > patch.mbox'].join('\n');
  }
  if (v === 'stash') {
    return [fileHistory, 'echo dirty >> f.txt'].join('\n');
  }
  if (v === 'restore' || v === 'reset' || v === 'revert' || v === 'cherry-pick') {
    return multiHistory;
  }
  if (v === 'submodule' || v === 'config') {
    return init;
  }
  return init;
}

export function seedIntentsToRows(seedIntents: string[]) {
  const skills = ['beginner', 'nontechnical', 'intermediate', 'expert', 'beginner'] as const;
  return seedIntents.map((intent_text, i) => ({
    skill_level: skills[i % skills.length]!,
    intent_category: 'goal' as const,
    intent_text: String(intent_text).trim(),
  }));
}

export function loadCanonicalPinsFile(filePath = canonicalPinsPath()): CanonicalPin[] {
  if (!existsSync(filePath)) return [];
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  const parsed = CanonicalPinsFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid canonical pins at ${filePath}: ${parsed.error.message}`);
  }
  return parsed.data.pins;
}

/**
 * Replace LLM placeholders so sketches can execute in the sandbox.
 * `<file>` / `<path>` → f.txt; strip other `<…>` tokens; soften remote URLs.
 */
export function normalizePinRecipeSketch(pin: CanonicalPin): CanonicalPin {
  const commands = pin.recipe_sketch.commands.map((step) => {
    let cmd = String(step.command || '').trim();
    cmd = cmd.replace(/<(?:file|path|pathspec)>/gi, 'f.txt');
    cmd = cmd.replace(/<commit>/gi, 'HEAD');
    cmd = cmd.replace(/<branch>/gi, 'main');
    cmd = cmd.replace(/<[^>]+>/g, 'x');
    // Prefer local bare remotes over network URLs in sketches.
    cmd = cmd.replace(
      /https?:\/\/[^\s]+/gi,
      '$GIT_GRASP_REMOTES/origin.git',
    );
    return { ...step, command: cmd };
  });
  return {
    ...pin,
    recipe_sketch: { commands },
  };
}

/**
 * Build a ground candidate from a pin (no LLM).
 */
export function pinToCandidate(pin: CanonicalPin) {
  const normalized = normalizePinRecipeSketch(pin);
  return {
    initial_state: (pin.initial_state && String(pin.initial_state).trim()) || initialStateForPin(normalized),
    command_recipe: {
      commands: normalized.recipe_sketch.commands.map((c) => ({
        command: c.command,
        comment: c.comment || pin.goal_id,
      })),
    },
    risk: pin.goal_roles.includes('dangerous') ? 0.7 : 0.25,
    pin_goal_id: pin.goal_id,
    mutation_kind: null as null,
  };
}

export type PinValidateOk = {
  ok: true;
  pin: CanonicalPin;
  candidate: ReturnType<typeof pinToCandidate>;
  initial_state_physical_hash: string;
  final_state_physical_hash: string;
  intents: ReturnType<typeof seedIntentsToRows>;
};

export type PinValidateSkip = {
  ok: false;
  pin: CanonicalPin;
  reason: string;
};

/**
 * Validate one pin sketch in the sandbox (fail-closed).
 */
export function validatePinForGround(
  pin: CanonicalPin,
  opts: {
    taxonomyVerbs: ReadonlySet<string>;
    workerId?: number;
    jobId?: string;
    validate?: (input: {
      initial_state: string;
      command_recipe: object;
      workerId?: number;
      jobId?: string;
    }) => { ok: boolean; reason?: string; initial_state_physical_hash?: string; final_state_physical_hash?: string };
  },
): PinValidateOk | PinValidateSkip {
  const structural = validateCanonicalPin(pin, { taxonomyVerbs: opts.taxonomyVerbs });
  if (!structural.ok) {
    return { ok: false, pin, reason: structural.reasons[0] || 'structural' };
  }
  const candidate = pinToCandidate(structural.pin);
  const validate = opts.validate || validateInSandboxAndDestroy;
  const result = validate({
    ...candidate,
    workerId: opts.workerId,
    jobId: opts.jobId || `pin-${pin.goal_id}`,
  });
  if (!result.ok) {
    return { ok: false, pin: structural.pin, reason: result.reason || 'sandbox' };
  }
  return {
    ok: true,
    pin: structural.pin,
    candidate,
    initial_state_physical_hash: result.initial_state_physical_hash!,
    final_state_physical_hash: result.final_state_physical_hash!,
    intents: seedIntentsToRows(structural.pin.seed_intents),
  };
}

export function emptyPinGroundStats(total = 0): PinGroundStats {
  return {
    pins_total: total,
    pins_attempted: 0,
    pins_inserted: 0,
    pins_dedup_merged: 0,
    pins_skipped: 0,
    skip_reasons: {},
    accepted_roles: [],
  };
}

export function bumpSkip(stats: PinGroundStats, reason: string) {
  stats.pins_skipped += 1;
  stats.skip_reasons[reason] = (stats.skip_reasons[reason] || 0) + 1;
}
