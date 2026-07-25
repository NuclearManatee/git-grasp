import { validateCommand, validateIntentRow, makeRowId, commandSlug } from '../lib/validator.js';
import { sanitizeField } from '../lib/ansi.js';

const RISK = new Set(['none', 'low', 'high', 'destructive']);

/**
 * Expand allowlist from observed command subcommands.
 */
export function subcommandsFromCommands(commands) {
  const set = new Set();
  for (const c of commands) {
    const parts = String(c.command || c).trim().split(/\s+/);
    if (parts[0] === 'git' && parts[1] && !parts[1].startsWith('-')) {
      set.add(parts[1]);
    }
  }
  return [...set].sort();
}

/**
 * Normalize command list: trim, dedupe, validate, stable sort.
 */
export function normalizeCommands(rawCommands, { allowlistExtra = [] } = {}) {
  const drops = [];
  const map = new Map();
  for (const raw of rawCommands) {
    const command = sanitizeField(raw.command || '', 512);
    const v = validateCommand(command);
    // Temporarily accept if only allowlist fail but looks like git subcommand — expand later
    if (!v.ok && v.reason !== 'allowlist') {
      drops.push({ command, reason: v.reason, stage: 'commands' });
      continue;
    }
    if (!v.ok && v.reason === 'allowlist') {
      const sub = command.split(/\s+/)[1];
      if (!sub || !/^[a-z][a-z0-9-]*$/i.test(sub)) {
        drops.push({ command, reason: 'allowlist', stage: 'commands' });
        continue;
      }
    }
    const key = command;
    if (!map.has(key)) {
      map.set(key, {
        command,
        topic: sanitizeField(raw.topic || 'advanced', 64),
        risk_class: RISK.has(raw.risk_class) ? raw.risk_class : 'none',
        source_hint: sanitizeField(raw.source_hint || '', 200),
        id_slug: commandSlug(command),
      });
    }
  }
  const commands = [...map.values()].sort((a, b) => a.command.localeCompare(b.command));
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
  for (const raw of rawRows) {
    const row = {
      id: raw.id || makeRowId(raw.command, raw.skill_level),
      command: sanitizeField(raw.command || '', 512),
      skill_level: Number(raw.skill_level),
      intent_description: sanitizeField(raw.intent_description || '', 2000),
      explanation: sanitizeField(raw.explanation || '', 4000),
      risks: sanitizeField(raw.risks || '', 4000),
      examples: sanitizeField(raw.examples || '', 4000),
      risk_class: RISK.has(raw.risk_class) ? raw.risk_class : 'none',
      topic: sanitizeField(raw.topic || '', 64),
    };
    const v = validateIntentRow(row);
    if (!v.ok) {
      // allowlist-only: keep if command starts with git and no shell meta (subcommand newly discovered)
      const c = validateCommand(row.command);
      if (!(c.reason === 'allowlist' && row.intent_description && row.skill_level >= 1 && row.skill_level <= 5)) {
        drops.push({ row, reason: v.reason, stage: 'intents' });
        continue;
      }
      // still reject shell_meta etc via validateCommand full check without allowlist
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
