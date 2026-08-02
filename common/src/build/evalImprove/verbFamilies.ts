// @ts-nocheck
/**
 * Verb family helpers for Pass B / judge context.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { verbFamiliesPath } from '../../lib/paths.js';
import { VerbFamiliesFileSchema } from '../../schemas/evalImprove.js';
import { goldensDistinguishFamilyMembers } from './validateProposals.js';

function normVerb(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * @param {{ familiesPath?: string, families?: object }} [opts]
 */
export function readVerbFamiliesFile(opts = {}) {
  if (opts.families) return VerbFamiliesFileSchema.parse(opts.families);
  const p = opts.familiesPath || verbFamiliesPath();
  if (!existsSync(p)) return { version: 1, families: [] };
  let text = readFileSync(p, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return VerbFamiliesFileSchema.parse(JSON.parse(text));
}

export function writeVerbFamiliesFile(file, opts = {}) {
  const p = opts.familiesPath || verbFamiliesPath();
  const parsed = VerbFamiliesFileSchema.parse(file);
  writeFileSync(p, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

/**
 * Build undirected verb → Set of family members (including self).
 * @param {object} [file]
 */
export function buildVerbFamilyIndex(file) {
  const parsed = file
    ? VerbFamiliesFileSchema.parse(file)
    : readVerbFamiliesFile();
  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  const add = (a, b) => {
    const ka = normVerb(a);
    const kb = normVerb(b);
    if (!ka || !kb) return;
    if (!map.has(ka)) map.set(ka, new Set([ka]));
    if (!map.has(kb)) map.set(kb, new Set([kb]));
    map.get(ka).add(kb);
    map.get(kb).add(ka);
  };
  for (const f of parsed.families || []) {
    add(f.canonical, f.canonical);
    for (const al of f.aliases || []) {
      add(f.canonical, al);
    }
  }
  return map;
}

/**
 * @param {string} verb
 * @param {Map<string, Set<string>>} [index]
 * @returns {Set<string>}
 */
export function verbsInFamily(verb, index) {
  const idx = index || buildVerbFamilyIndex();
  const k = normVerb(verb);
  if (!k) return new Set();
  return new Set(idx.get(k) || [k]);
}

export function mergeVerbFamilyProposals(file, proposals) {
  const families = [...(file.families || [])];
  const byCanon = new Map(families.map((f, i) => [normVerb(f.canonical), i]));
  for (const p of proposals || []) {
    if (p.kind !== 'verb_family') continue;
    const key = normVerb(p.canonical);
    const row = {
      canonical: p.canonical,
      aliases: p.aliases,
      source: 'eval_round',
      evidence_command_ids: p.evidence_command_ids,
    };
    if (byCanon.has(key)) {
      const prev = families[byCanon.get(key)];
      const aliases = [...new Set([...(prev.aliases || []), ...p.aliases])];
      families[byCanon.get(key)] = { ...prev, ...row, aliases };
    } else {
      byCanon.set(key, families.length);
      families.push(row);
    }
  }
  return VerbFamiliesFileSchema.parse({ version: file.version || 1, families });
}

/**
 * Drop eval_round families whose members are distinguished by goldens.
 * Seed families are never pruned.
 * @param {object} file
 * @param {object[]} goldenBank
 * @returns {{ file: object, pruned: object[] }}
 */
export function pruneDistinguishedEvalRoundFamilies(file, goldenBank) {
  const pruned = [];
  const families = [];
  for (const f of file?.families || []) {
    if (f.source !== 'eval_round') {
      families.push(f);
      continue;
    }
    const members = [f.canonical, ...(f.aliases || [])];
    if (goldensDistinguishFamilyMembers(members, goldenBank || [])) {
      pruned.push(f);
      continue;
    }
    families.push(f);
  }
  return {
    file: VerbFamiliesFileSchema.parse({
      version: file?.version || 1,
      families,
    }),
    pruned,
  };
}
