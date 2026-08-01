/**
 * LLM-driven taxonomy role tagging + canonical pins (passes A–D).
 * Artifacts are regenerable; validators fail closed.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  PACKAGE_ROOT,
  gitCommandsTaxonomyPath,
  gitCommandsRolesPath,
  canonicalPinsPath,
} from '../lib/paths.js';
import { renderPrompt } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import { fetchGitShortHelp } from './gitShortHelp.js';
import { SHELL_META } from '../schemas/gitCommand.js';
import {
  GOAL_ROLES,
  PIN_WORTHY_ROLES,
  CRITICAL_PIN_ROLES,
  GoalRoleSchema,
  CanonicalPinSchema,
  TagRolesLlmResponseSchema,
  DraftPinsLlmResponseSchema,
  GapFillLlmResponseSchema,
  RepairPinsLlmResponseSchema,
  RolesFileSchema,
  CanonicalPinsFileSchema,
  type GoalRole,
  type CanonicalPin,
  type RolesFile,
  type CanonicalPinsFile,
} from '../schemas/taxonomyPins.js';
import { loadGitCommandTaxonomy } from './prepare.js';
import { validatePinForGround } from './pinGround.js';

export const GUI_VERBS = new Set([
  'citool',
  'gui',
  'gitk',
  'git-gui',
  'git-citool',
]);

export const ROLE_TAG_BATCH_SIZE = 20;

export type PinValidationFailure = {
  pin: CanonicalPin | Record<string, unknown>;
  reasons: string[];
};

export type PinValidationOk = { ok: true; pin: CanonicalPin };
export type PinValidationErr = { ok: false; pin: CanonicalPin | Record<string, unknown>; reasons: string[] };
export type PinValidationResult = PinValidationOk | PinValidationErr;

function verbName(command: string): string {
  const parts = String(command || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts[0] === 'git' && parts[1]) return parts[1]!.toLowerCase();
  return (parts[0] || '').toLowerCase();
}

function countFlags(command: string): number {
  return String(command || '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.startsWith('-') && t !== '--').length;
}

function normalizeIntent(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapse near-duplicate seed intents (exact normalized match). */
export function collapseNearDupIntents(intents: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of intents) {
    const n = normalizeIntent(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(String(raw).trim());
  }
  return out;
}

/**
 * Structural pin validator (fail-closed). Does not write anything.
 */
export function validateCanonicalPin(
  raw: unknown,
  opts: { taxonomyVerbs: ReadonlySet<string> },
): PinValidationResult {
  const reasons: string[] = [];
  const parsed = CanonicalPinSchema.safeParse(raw);
  if (!parsed.success) {
    reasons.push(`schema: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    return { ok: false, pin: (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, reasons };
  }
  const pin = {
    ...parsed.data,
    seed_intents: collapseNearDupIntents(parsed.data.seed_intents),
  };
  if (pin.seed_intents.length < 3) {
    reasons.push('seed_intents_too_few_after_dedupe');
  }

  // Ban LLM placeholders that cannot execute in sandbox.
  const sketchText = JSON.stringify(pin.recipe_sketch);
  if (/<[^>]+>/.test(sketchText)) {
    reasons.push('placeholder_angle_brackets');
  }

  const verb = String(pin.verb || '').trim();
  if (!opts.taxonomyVerbs.has(verb)) {
    reasons.push(`verb_not_in_taxonomy: ${verb}`);
  }

  const vName = verbName(verb);
  if (GUI_VERBS.has(vName) || GUI_VERBS.has(verb.replace(/^git\s+/i, '').toLowerCase())) {
    reasons.push(`gui_verb: ${verb}`);
  }

  const steps = pin.recipe_sketch.commands || [];
  if (steps.length < 1 || steps.length > 2) {
    reasons.push(`step_count: ${steps.length}`);
  }

  for (let i = 0; i < steps.length; i += 1) {
    const cmd = String(steps[i]?.command || '').trim();
    if (!cmd) {
      reasons.push(`empty_command_step_${i}`);
      continue;
    }
    if (!/^git(\s|$)/i.test(cmd)) {
      reasons.push(`not_git_invocation_step_${i}`);
    }
    if (SHELL_META.test(cmd)) {
      reasons.push(`shell_meta_step_${i}`);
    }
    const flags = countFlags(cmd);
    if (flags > 2) {
      reasons.push(`too_many_flags_step_${i}: ${flags}`);
    }
    const stepVerb = verbName(cmd);
    if (GUI_VERBS.has(stepVerb)) {
      reasons.push(`gui_verb_step_${i}: ${stepVerb}`);
    }
  }

  if (steps.length > 0) {
    const primary = String(steps[0]?.command || '').trim();
    const expected = verbName(verb);
    const actual = verbName(primary);
    if (expected && actual !== expected) {
      reasons.push(`primary_verb_mismatch: expected ${verb}, got ${primary}`);
    }
  }

  if (reasons.length) {
    return { ok: false, pin, reasons };
  }
  return { ok: true, pin };
}

/** Validate role tags for a command. */
export function validateCommandRoles(
  raw: unknown,
  opts: { taxonomyVerbs: ReadonlySet<string> },
): { ok: true; command: string; goal_roles: GoalRole[] } | { ok: false; reasons: string[]; command?: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reasons: ['schema'] };
  }
  const obj = raw as { command?: unknown; goal_roles?: unknown };
  const command = String(obj.command || '').trim();
  if (!command || !opts.taxonomyVerbs.has(command)) {
    return { ok: false, reasons: [`unknown_command: ${command}`], command };
  }
  if (GUI_VERBS.has(verbName(command))) {
    return { ok: false, reasons: [`gui_verb: ${command}`], command };
  }
  if (!Array.isArray(obj.goal_roles) || obj.goal_roles.length < 1) {
    return { ok: false, reasons: ['goal_roles_empty'], command };
  }
  const roles: GoalRole[] = [];
  for (const r of obj.goal_roles) {
    const p = GoalRoleSchema.safeParse(r);
    if (!p.success) {
      return { ok: false, reasons: [`invalid_role: ${r}`], command };
    }
    if (!roles.includes(p.data)) roles.push(p.data);
  }
  return { ok: true, command, goal_roles: roles };
}

/**
 * Validate a pin list: schema + structural + dedupe goal_id. Fail-closed per row.
 */
export function validatePinList(
  pins: unknown[],
  opts: { taxonomyVerbs: ReadonlySet<string> },
): { valid: CanonicalPin[]; invalid: PinValidationFailure[] } {
  const valid: CanonicalPin[] = [];
  const invalid: PinValidationFailure[] = [];
  const seenIds = new Set<string>();

  for (const raw of pins) {
    const result = validateCanonicalPin(raw, opts);
    if (!result.ok) {
      invalid.push({ pin: result.pin, reasons: result.reasons });
      continue;
    }
    const id = result.pin.goal_id;
    if (seenIds.has(id)) {
      invalid.push({ pin: result.pin, reasons: [`duplicate_goal_id: ${id}`] });
      continue;
    }
    seenIds.add(id);
    valid.push(result.pin);
  }
  return { valid, invalid };
}

function firstUsageLine(helpText: string): string {
  const lines = String(helpText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const usage = lines.find((l) => /^usage:/i.test(l));
  return (usage || lines[0] || '').slice(0, 240);
}

export function loadShortHelpLines(
  commands: { command: string }[],
  opts: {
    fetchHelp?: typeof fetchGitShortHelp;
    timeoutMs?: number;
    log?: (msg: string) => void;
  } = {},
): Map<string, string> {
  const fetch = opts.fetchHelp || fetchGitShortHelp;
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const log = opts.log;
  const map = new Map<string, string>();
  let i = 0;
  for (const c of commands) {
    i += 1;
    if (GUI_VERBS.has(verbName(c.command))) {
      map.set(c.command, '');
      continue;
    }
    const help = fetch(c.command, { timeoutMs });
    map.set(c.command, firstUsageLine(help.text));
    if (log && (i % 20 === 0 || i === commands.length)) {
      log(`Short-help progress ${i}/${commands.length}`);
    }
  }
  return map;
}

function needsPin(roles: GoalRole[]): boolean {
  return roles.some((r) => PIN_WORTHY_ROLES.has(r));
}

export type TaxonomyPinsDeps = {
  llmJsonObject?: typeof llmJsonObject;
  fetchHelp?: typeof fetchGitShortHelp;
  taxonomyPath?: string;
  rolesOutPath?: string;
  pinsOutPath?: string;
  missSummaryPath?: string;
  /** Skip Pass A and load goal_roles from an existing roles file. */
  reuseRolesPath?: string | null;
  /** Inject sandbox validator (tests). */
  validatePin?: Parameters<typeof validatePinForGround>[1]['validate'];
  log?: (msg: string) => void;
};

function defaultMissSummaryPath() {
  return path.join(PACKAGE_ROOT, 'data', 'eval', 'last-miss-summary.json');
}

function loadOptionalMissSummary(filePath: string): string {
  if (!existsSync(filePath)) return '';
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2).slice(0, 8_000);
  } catch {
    return '';
  }
}

/**
 * Pass A: tag goal_roles for each taxonomy command (batched ~20).
 */
export async function passATagRoles(
  taxonomy: ReturnType<typeof loadGitCommandTaxonomy>,
  helpLines: Map<string, string>,
  deps: TaxonomyPinsDeps = {},
): Promise<Map<string, GoalRole[]>> {
  const call = deps.llmJsonObject || llmJsonObject;
  const log = deps.log || console.log;
  const taxonomyVerbs = new Set(taxonomy.commands.map((c) => c.command));
  const roleMap = new Map<string, GoalRole[]>();

  const bySection = new Map<string, typeof taxonomy.commands>();
  for (const c of taxonomy.commands) {
    const sec = c.section || 'unknown';
    if (!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec)!.push(c);
  }

  for (const [section, cmds] of bySection) {
    for (let i = 0; i < cmds.length; i += ROLE_TAG_BATCH_SIZE) {
      const batch = cmds.slice(i, i + ROLE_TAG_BATCH_SIZE);
      const batch_text = batch
        .map((c) => {
          const usage = helpLines.get(c.command) || '';
          return `- ${c.command}: ${c.summary || ''}${usage ? ` | ${usage}` : ''}`;
        })
        .join('\n');

      const { messages } = renderPrompt('taxonomy/tag-roles', {
        section,
        roles_enum: GOAL_ROLES.join(' | '),
        batch_text,
      });

      log(`Pass A: tagging roles ${section} [${i + 1}–${Math.min(i + batch.length, cmds.length)}/${cmds.length}]`);
      const data = await call({
        messages,
        schema: TagRolesLlmResponseSchema,
      });

      for (const item of data.items) {
        const v = validateCommandRoles(item, { taxonomyVerbs });
        if (!v.ok) {
          log(`  skip roles for ${item.command}: ${v.reasons.join(', ')}`);
          continue;
        }
        roleMap.set(v.command, v.goal_roles);
      }
    }
  }

  // Fill any missing with niche (fail-closed soft default so every command has roles)
  for (const c of taxonomy.commands) {
    if (!roleMap.has(c.command)) {
      if (GUI_VERBS.has(verbName(c.command))) {
        roleMap.set(c.command, ['niche']);
      } else {
        roleMap.set(c.command, ['niche']);
        log(`  default niche for untagged ${c.command}`);
      }
    }
  }

  return roleMap;
}

/**
 * Pass B: draft pins for pin-worthy verbs.
 */
export async function passBDraftPins(
  taxonomy: ReturnType<typeof loadGitCommandTaxonomy>,
  roleMap: Map<string, GoalRole[]>,
  helpLines: Map<string, string>,
  deps: TaxonomyPinsDeps = {},
): Promise<{ valid: CanonicalPin[]; invalid: PinValidationFailure[] }> {
  const call = deps.llmJsonObject || llmJsonObject;
  const log = deps.log || console.log;
  const taxonomyVerbs = new Set(taxonomy.commands.map((c) => c.command));

  const worthy = taxonomy.commands.filter((c) => {
    if (GUI_VERBS.has(verbName(c.command))) return false;
    return needsPin(roleMap.get(c.command) || []);
  });

  const allValid: CanonicalPin[] = [];
  const allInvalid: PinValidationFailure[] = [];
  const seenIds = new Set<string>();

  // Small batches: large multi-verb drafts truncate / fail schema and look hung.
  const BATCH = 3;
  log(`Pass B: ${worthy.length} pin-worthy verbs in batches of ${BATCH}`);
  for (let i = 0; i < worthy.length; i += BATCH) {
    const batch = worthy.slice(i, i + BATCH);
    const verbs_block = batch
      .map((c) => {
        const roles = (roleMap.get(c.command) || []).join(', ');
        const usage = helpLines.get(c.command) || '';
        return `### ${c.command}\nsummary: ${c.summary || ''}\nroles: ${roles}\nusage: ${usage}`;
      })
      .join('\n\n');

    const { messages } = renderPrompt('taxonomy/draft-pins', {
      roles_enum: GOAL_ROLES.join(' | '),
      pin_worthy: [...PIN_WORTHY_ROLES].join(', '),
      verbs_block,
    });

    const label = `Pass B: draft pins [${i + 1}–${Math.min(i + batch.length, worthy.length)}/${worthy.length}] (${batch.map((c) => c.command).join(', ')})`;
    log(label);
    const t0 = Date.now();
    let data: { pins: unknown[] };
    try {
      data = await call({
        messages,
        schema: DraftPinsLlmResponseSchema,
        maxTokens: 4096,
      });
    } catch (err) {
      log(`  ${label} FAILED after ${Date.now() - t0}ms: ${(err as Error).message}`);
      continue;
    }
    log(`  ok in ${Date.now() - t0}ms → ${data.pins.length} raw pin(s)`);

    const { valid, invalid } = validatePinList(data.pins, { taxonomyVerbs });
    if (invalid.length) {
      log(`  ${invalid.length} invalid: ${invalid.map((f) => f.reasons[0]).join('; ')}`);
    }
    allInvalid.push(...invalid);
    for (const p of valid) {
      if (seenIds.has(p.goal_id)) {
        allInvalid.push({ pin: p, reasons: [`duplicate_goal_id: ${p.goal_id}`] });
        continue;
      }
      seenIds.add(p.goal_id);
      allValid.push(p);
    }
  }

  return { valid: allValid, invalid: allInvalid };
}

/**
 * Pass C: completeness gap-fill (max 1 round).
 */
export async function passCGapFill(
  taxonomy: ReturnType<typeof loadGitCommandTaxonomy>,
  roleMap: Map<string, GoalRole[]>,
  pins: CanonicalPin[],
  deps: TaxonomyPinsDeps = {},
): Promise<{ pins: CanonicalPin[]; invalid: PinValidationFailure[] }> {
  const call = deps.llmJsonObject || llmJsonObject;
  const log = deps.log || console.log;
  const taxonomyVerbs = new Set(taxonomy.commands.map((c) => c.command));
  const missPath = deps.missSummaryPath || defaultMissSummaryPath();
  const miss_summary = loadOptionalMissSummary(missPath);

  const taxonomy_summary = taxonomy.commands
    .map((c) => {
      const roles = (roleMap.get(c.command) || []).join(',');
      return `${c.command} [${roles}] — ${c.summary || ''}`;
    })
    .join('\n');

  const current_pins = pins
    .map((p) => `- ${p.goal_id} | ${p.verb} | roles=${p.goal_roles.join(',')} | intents=${p.seed_intents.slice(0, 2).join('; ')}`)
    .join('\n');

  const { messages } = renderPrompt('taxonomy/gap-fill', {
    roles_enum: GOAL_ROLES.join(' | '),
    pin_worthy: [...PIN_WORTHY_ROLES].join(', '),
    taxonomy_summary,
    current_pins: current_pins || '(none)',
    miss_summary: miss_summary || '(none)',
  });

  log('Pass C: completeness gap-fill');
  const t0 = Date.now();
  let data: { pins: unknown[] };
  try {
    data = await call({
      messages,
      schema: GapFillLlmResponseSchema,
      maxTokens: 4096,
    });
  } catch (err) {
    log(`Pass C FAILED after ${Date.now() - t0}ms: ${(err as Error).message}`);
    return { pins, invalid: [] };
  }
  log(`Pass C ok in ${Date.now() - t0}ms → ${data.pins.length} new raw pin(s)`);

  if (!data.pins.length) {
    return { pins, invalid: [] };
  }

  const seen = new Set(pins.map((p) => p.goal_id));
  const { valid, invalid } = validatePinList(data.pins, { taxonomyVerbs });
  const merged = [...pins];
  for (const p of valid) {
    if (seen.has(p.goal_id)) {
      invalid.push({ pin: p, reasons: [`duplicate_goal_id: ${p.goal_id}`] });
      continue;
    }
    seen.add(p.goal_id);
    merged.push(p);
  }
  return { pins: merged, invalid };
}

/**
 * Pass D: repair failed rows (max 1 round), then drop still-invalid.
 */
export async function passDRepair(
  invalid: PinValidationFailure[],
  taxonomyVerbs: ReadonlySet<string>,
  deps: TaxonomyPinsDeps = {},
): Promise<{ repaired: CanonicalPin[]; stillInvalid: PinValidationFailure[] }> {
  if (!invalid.length) return { repaired: [], stillInvalid: [] };
  const call = deps.llmJsonObject || llmJsonObject;
  const log = deps.log || console.log;

  const failures_block = invalid
    .map((f, i) => {
      return `### failure ${i + 1}\nreasons: ${f.reasons.join('; ')}\npin:\n${JSON.stringify(f.pin, null, 2)}`;
    })
    .join('\n\n');

  const { messages } = renderPrompt('taxonomy/repair-pins', {
    roles_enum: GOAL_ROLES.join(' | '),
    failures_block,
  });

  log(`Pass D: repair ${invalid.length} failed pin(s)`);
  const t0 = Date.now();
  let data: { pins: unknown[]; dropped_goal_ids?: string[] };
  try {
    data = await call({
      messages,
      schema: RepairPinsLlmResponseSchema,
      maxTokens: 4096,
    });
  } catch (err) {
    log(`Pass D FAILED after ${Date.now() - t0}ms: ${(err as Error).message}`);
    return { repaired: [], stillInvalid: invalid };
  }
  log(`Pass D ok in ${Date.now() - t0}ms → ${data.pins.length} repaired raw`);

  const { valid, invalid: still } = validatePinList(data.pins, { taxonomyVerbs });
  const returnedIds = new Set(
    [...valid, ...still.map((s) => (s.pin as { goal_id?: string }).goal_id)].filter(Boolean) as string[],
  );
  const droppedExplicit = new Set(data.dropped_goal_ids || []);
  const unrepaired: PinValidationFailure[] = [];
  for (const f of invalid) {
    const id = (f.pin as { goal_id?: string }).goal_id;
    if (id && (returnedIds.has(id) || droppedExplicit.has(id))) continue;
    // Not returned and not explicitly dropped → still invalid / dropped
    unrepaired.push(f);
  }
  for (const id of droppedExplicit) {
    if (valid.some((p) => p.goal_id === id)) continue;
    const orig = invalid.find((f) => (f.pin as { goal_id?: string }).goal_id === id);
    if (orig) unrepaired.push(orig);
    else unrepaired.push({ pin: { goal_id: id }, reasons: ['explicitly_dropped'] });
  }
  return { repaired: valid, stillInvalid: [...still, ...unrepaired] };
}

/**
 * Full A–D pipeline. Writes roles + canonical pins (valid rows only).
 */
export async function runTaxonomyPins(deps: TaxonomyPinsDeps = {}): Promise<{
  rolesPath: string;
  pinsPath: string;
  roles: RolesFile;
  pins: CanonicalPinsFile;
  stats: {
    tagged: number;
    pins_valid: number;
    pins_dropped: number;
    gap_added: number;
    repaired: number;
  };
}> {
  const log = deps.log || console.log;
  const taxonomyPath = deps.taxonomyPath || gitCommandsTaxonomyPath();
  const rolesOut = deps.rolesOutPath || gitCommandsRolesPath();
  const pinsOut = deps.pinsOutPath || canonicalPinsPath();

  const taxonomy = loadGitCommandTaxonomy(taxonomyPath);
  const taxonomyVerbs = new Set(taxonomy.commands.map((c) => c.command));
  log(`Loaded taxonomy: ${taxonomy.commands.length} commands from ${taxonomyPath}`);

  const helpLines = loadShortHelpLines(taxonomy.commands, {
    fetchHelp: deps.fetchHelp,
    timeoutMs: 3_000,
    log,
  });
  log(`Collected short-help lines for ${helpLines.size} verbs`);

  let roleMap: Map<string, GoalRole[]>;
  let rolesFile: RolesFile;
  const generated_at = new Date().toISOString();

  if (deps.reuseRolesPath && existsSync(deps.reuseRolesPath)) {
    log(`Reusing roles from ${deps.reuseRolesPath} (skip Pass A)`);
    const raw = JSON.parse(readFileSync(deps.reuseRolesPath, 'utf8'));
    rolesFile = RolesFileSchema.parse(raw);
    roleMap = new Map(rolesFile.commands.map((c) => [c.command, c.goal_roles as GoalRole[]]));
    for (const c of taxonomy.commands) {
      if (!roleMap.has(c.command)) roleMap.set(c.command, ['niche']);
    }
  } else {
    roleMap = await passATagRoles(taxonomy, helpLines, deps);
    rolesFile = RolesFileSchema.parse({
      version: 1,
      generated_at,
      source_taxonomy: path.relative(PACKAGE_ROOT, taxonomyPath).replace(/\\/g, '/'),
      commands: taxonomy.commands.map((c) => ({
        name: c.name,
        summary: c.summary || '',
        command: c.command,
        section: c.section,
        goal_roles: roleMap.get(c.command) || ['niche'],
      })),
    });
    mkdirSync(path.dirname(rolesOut), { recursive: true });
    writeFileSync(rolesOut, `${JSON.stringify(rolesFile, null, 2)}\n`);
    log(`Wrote roles → ${rolesOut}`);
  }

  const draft = await passBDraftPins(taxonomy, roleMap, helpLines, deps);
  let pendingInvalid = [...draft.invalid];
  let pins = [...draft.valid];
  const beforeGap = pins.length;

  const gap = await passCGapFill(taxonomy, roleMap, pins, deps);
  pins = gap.pins;
  pendingInvalid.push(...gap.invalid);
  const gap_added = pins.length - beforeGap;

  const repair = await passDRepair(pendingInvalid, taxonomyVerbs, deps);
  const seen = new Set(pins.map((p) => p.goal_id));
  let repaired = 0;
  for (const p of repair.repaired) {
    if (seen.has(p.goal_id)) continue;
    seen.add(p.goal_id);
    pins.push(p);
    repaired += 1;
  }
  if (repair.stillInvalid.length) {
    log(`Dropped ${repair.stillInvalid.length} still-invalid pin(s) after structural repair`);
  }

  // Sandbox dry-run gate before write (fail-closed).
  const sandboxOk: CanonicalPin[] = [];
  const dropped: { goal_id?: string; verb?: string; reasons: string[] }[] = [];
  for (const f of repair.stillInvalid) {
    dropped.push({
      goal_id: (f.pin as { goal_id?: string }).goal_id,
      verb: (f.pin as { verb?: string }).verb,
      reasons: f.reasons,
    });
  }

  let sandboxFailRound: PinValidationFailure[] = [];
  for (const pin of pins) {
    const r = validatePinForGround(pin, {
      taxonomyVerbs,
      jobId: `taxonomy-pin-${pin.goal_id}`,
      validate: deps.validatePin,
    });
    if (r.ok) {
      const withState = {
        ...pin,
        initial_state: pin.initial_state || r.candidate.initial_state,
      };
      sandboxOk.push(withState);
    } else {
      sandboxFailRound.push({ pin, reasons: [r.reason] });
    }
  }

  if (sandboxFailRound.length) {
    log(`Sandbox gate: ${sandboxFailRound.length} pin(s) failed; Pass D repair round 2`);
    const repair2 = await passDRepair(sandboxFailRound, taxonomyVerbs, deps);
    for (const p of repair2.repaired) {
      const r = validatePinForGround(p, {
        taxonomyVerbs,
        jobId: `taxonomy-pin-r2-${p.goal_id}`,
        validate: deps.validatePin,
      });
      if (r.ok && !sandboxOk.some((x) => x.goal_id === p.goal_id)) {
        sandboxOk.push({
          ...p,
          initial_state: p.initial_state || r.candidate.initial_state,
        });
        repaired += 1;
      } else if (!r.ok) {
        dropped.push({ goal_id: p.goal_id, verb: p.verb, reasons: [r.reason] });
      }
    }
    for (const f of repair2.stillInvalid) {
      dropped.push({
        goal_id: (f.pin as { goal_id?: string }).goal_id,
        verb: (f.pin as { verb?: string }).verb,
        reasons: f.reasons,
      });
    }
  }

  pins = sandboxOk;
  const criticalMissing = [...CRITICAL_PIN_ROLES].filter(
    (role) => !pins.some((p) => p.goal_roles.includes(role)),
  );
  if (criticalMissing.length) {
    log(`WARN critical pin roles missing after sandbox gate: ${criticalMissing.join(', ')}`);
  }

  const pinsFile: CanonicalPinsFile = CanonicalPinsFileSchema.parse({
    version: 1,
    generated_at,
    pins,
    dropped,
  });

  mkdirSync(path.dirname(pinsOut), { recursive: true });
  writeFileSync(pinsOut, `${JSON.stringify(pinsFile, null, 2)}\n`);
  log(`Wrote ${pins.length} canonical pins (${dropped.length} dropped) → ${pinsOut}`);

  return {
    rolesPath: rolesOut,
    pinsPath: pinsOut,
    roles: rolesFile,
    pins: pinsFile,
    stats: {
      tagged: roleMap.size,
      pins_valid: pins.length,
      pins_dropped: dropped.length,
      gap_added,
      repaired,
      critical_missing: criticalMissing,
    },
  };
}
