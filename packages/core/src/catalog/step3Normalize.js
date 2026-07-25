import {
  validateCommand,
  validateIntentRow,
  validateExample,
  makeRowId,
  commandSlug,
  normalizeExample,
} from '../lib/validator.js';
import { sanitizeField } from '../lib/ansi.js';
import { isValidSkillLevel, SKILL_MAX } from '../lib/skills.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from './step0Glossary.js';
import { deriveCommandKey } from './step1Commands.js';
import { normalizeUsage } from '../db/utils.js';

/**
 * Expand allowlist from observed command subcommands.
 */
export function subcommandsFromCommands(commands) {
  const set = new Set();
  for (const c of commands) {
    const text = c.command || c.example || c;
    const parts = String(text).trim().split(/\s+/);
    if (parts[0] === 'git' && parts[1] && !parts[1].startsWith('-')) {
      set.add(parts[1]);
    }
  }
  return [...set].sort();
}

/**
 * Normalize flat example list (or legacy command list): E4 dedupe, validate.
 */
export function normalizeCommands(rawCommands, {
  allowlistExtra = [],
  glossary = DEFAULT_GLOSSARY,
} = {}) {
  const drops = [];
  const map = new Map();
  for (const raw of rawCommands) {
    let example = sanitizeField(raw.example || raw.command || '', 512);
    example = normalizeExample(materializePlaceholders(example, glossary));
    let command = sanitizeField(raw.command || '', 512);
    if (!command) command = deriveCommandKey(example, example);
    command = normalizeExample(materializePlaceholders(command, glossary));

    const vEx = validateExample(example);
    const vCmd = validateCommand(command);
    if (!vEx.ok && vEx.reason !== 'allowlist') {
      drops.push({ example, command, reason: vEx.reason, stage: 'commands' });
      continue;
    }
    if (!vCmd.ok && vCmd.reason !== 'allowlist') {
      drops.push({ example, command, reason: vCmd.reason, stage: 'commands' });
      continue;
    }
    if (!vEx.ok && vEx.reason === 'allowlist') {
      const sub = example.split(/\s+/)[1];
      if (!sub || !/^[a-z][a-z0-9-]*$/i.test(sub)) {
        drops.push({ example, command, reason: 'allowlist', stage: 'commands' });
        continue;
      }
    }

    const key = normalizeExample(example);
    if (!map.has(key)) {
      map.set(key, {
        command,
        example: key,
        topic: sanitizeField(raw.topic || 'advanced', 64),
        source_hint: sanitizeField(raw.source_hint || '', 200),
        intent_family: sanitizeField(raw.intent_family || '', 128),
        simplicity_rank: Math.max(1, Number(raw.simplicity_rank) || 1),
        usage: normalizeUsage(raw.usage, key),
        id_slug: commandSlug(key),
      });
    }
  }
  const commands = [...map.values()].sort((a, b) => a.example.localeCompare(b.example));
  const allowlist = [...new Set([
    ...allowlistExtra,
    ...subcommandsFromCommands(commands),
  ])].sort();
  return { commands, drops, allowlist };
}

/**
 * Normalize intent rows: validate, sanitize, ensure ids, dedupe by id.
 */
export function normalizeIntents(rawRows) {
  const drops = [];
  const map = new Map();
  const intentIndexByKey = new Map();
  for (const raw of rawRows) {
    const example = normalizeExample(raw.example || raw.command || '');
    const command = normalizeExample(raw.command || example);
    const skill_level = Number(raw.skill_level);
    const indexKey = `${example}:${skill_level}`;
    let intentIndex = Number(raw.intent_index);
    if (!Number.isInteger(intentIndex)) {
      intentIndex = intentIndexByKey.get(indexKey) || 0;
      intentIndexByKey.set(indexKey, intentIndex + 1);
    }
    const row = {
      id: raw.id || makeRowId(example, skill_level, intentIndex),
      command,
      example,
      usage: normalizeUsage(raw.usage, example),
      intent_family: sanitizeField(raw.intent_family || '', 128),
      simplicity_rank: Math.max(1, Number(raw.simplicity_rank) || 1),
      skill_level,
      intent_description: sanitizeField(raw.intent_description || '', 2000),
      explanation: sanitizeField(raw.explanation || '', 4000),
      topic: sanitizeField(raw.topic || '', 64),
    };
    const v = validateIntentRow(row);
    if (!v.ok) {
      const c = validateCommand(row.command);
      const okAllow = c.reason === 'allowlist'
        && row.intent_description
        && isValidSkillLevel(row.skill_level);
      if (!okAllow) {
        drops.push({ row, reason: v.reason, stage: 'intents' });
        continue;
      }
      if (c.reason && c.reason !== 'allowlist') {
        drops.push({ row, reason: c.reason, stage: 'intents' });
        continue;
      }
    }
    map.set(row.id, row);
  }
  return {
    intents: [...map.values()].sort((a, b) => a.id.localeCompare(b.id)),
    drops,
  };
}

export { SKILL_MAX };
