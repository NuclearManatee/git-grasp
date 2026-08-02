// @ts-nocheck
/**
 * Validate Pro proposal batch against train failures + taxonomy.
 */
import {
  EvalImproveProposalBatchSchema,
  EVAL_IMPROVE_MAX_TRAPS_PER_ROUND,
  EVAL_IMPROVE_MAX_FAMILIES_PER_ROUND,
} from '../../schemas/evalImprove.js';

function normVerb(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function needleInQuery(needle, queryText) {
  return String(queryText || '')
    .toLowerCase()
    .includes(String(needle || '').toLowerCase());
}

/**
 * Destructive / unsafe antonym pairs that must never become verb families.
 * Undirected.
 */
export const FORBIDDEN_VERB_FAMILY_PAIRS = [
  ['git revert', 'git reset'],
  ['git reset', 'git clean'],
  ['git checkout', 'git reset'],
  ['git restore', 'git reset'],
];

/**
 * @param {string} a
 * @param {string} b
 */
export function isForbiddenVerbFamilyPair(a, b) {
  const na = normVerb(a);
  const nb = normVerb(b);
  if (!na || !nb || na === nb) return false;
  for (const [x, y] of FORBIDDEN_VERB_FAMILY_PAIRS) {
    const nx = normVerb(x);
    const ny = normVerb(y);
    if ((na === nx && nb === ny) || (na === ny && nb === nx)) return true;
  }
  return false;
}

/**
 * True when query_text names the verb (with optional "git " prefix).
 * Word boundaries prevent "git diff" matching inside "git difftool".
 * @param {string} queryText
 * @param {string} verb
 */
export function queryMentionsVerb(queryText, verb) {
  const q = String(queryText || '').toLowerCase();
  const v = normVerb(verb);
  if (!q || !v) return false;
  const bare = v.replace(/^git\s+/, '');
  if (!bare) return false;
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(?:git\\s+)?${escaped}\\b`, 'i');
  return re.test(q);
}

/**
 * Reject families when goldens distinguish ≥2 members by naming them
 * in separate (or the same) query texts — they are not retrieval synonyms.
 * @param {string[]} members canonical + aliases
 * @param {object[]} goldenBank rows with query_text
 */
export function goldensDistinguishFamilyMembers(members, goldenBank) {
  const uniq = [...new Set((members || []).map(normVerb).filter(Boolean))];
  if (uniq.length < 2) return false;
  const mentioned = new Set();
  for (const member of uniq) {
    for (const row of goldenBank || []) {
      const text = row?.query_text || row?.query?.query_text || '';
      if (queryMentionsVerb(text, member)) {
        mentioned.add(member);
        break;
      }
    }
  }
  return mentioned.size >= 2;
}

/**
 * Reject needles that copy judge reason text (simple overlap).
 * @param {string} needle
 * @param {string[]} reasons
 */
export function needleCopiesJudgeReason(needle, reasons) {
  const n = String(needle || '').trim().toLowerCase();
  if (n.length < 4) return false;
  for (const reason of reasons || []) {
    const r = String(reason || '').trim().toLowerCase();
    if (!r) continue;
    if (r.includes(n) || n.includes(r)) return true;
    const nt = new Set(n.split(/\W+/).filter((t) => t.length >= 4));
    const rt = r.split(/\W+/).filter((t) => t.length >= 4);
    let shared = 0;
    for (const t of rt) {
      if (nt.has(t)) shared += 1;
      if (shared >= 3) return true;
    }
  }
  return false;
}

/**
 * Train failure rows whose query_text matches any needle.
 * @param {string[]} needles
 * @param {object[]} trainMisses
 */
export function trainMissesMatchingNeedles(needles, trainMisses) {
  return (trainMisses || []).filter((m) => {
    const q = m?.query?.query_text || '';
    return (needles || []).some((n) => needleInQuery(n, q));
  });
}

/**
 * Trap generality: ≥2 distinct train-miss command_ids in evidence,
 * OR ≥1 evidence id and ≥2 train failure queries matched by needles.
 * @param {number[]} evidenceTrainIds
 * @param {string[]} needles
 * @param {object[]} trainMisses
 */
export function trapEvidenceMeetsGenerality(evidenceTrainIds, needles, trainMisses) {
  const ids = [...new Set((evidenceTrainIds || []).map(Number))].filter(
    (id) => Number.isFinite(id) && id > 0,
  );
  if (ids.length >= 2) return { ok: true, via: 'command_ids', ids };
  if (ids.length < 1) return { ok: false, via: 'none', ids, matchedQueries: 0 };
  const matched = trainMissesMatchingNeedles(needles, trainMisses);
  if (matched.length >= 2) {
    return { ok: true, via: 'queries', ids, matchedQueries: matched.length };
  }
  return {
    ok: false,
    via: 'insufficient',
    ids,
    matchedQueries: matched.length,
  };
}

/**
 * @param {unknown} rawBatch
 * @param {{
 *   trainMisses: object[],
 *   taxonomyVerbs: string[],
 *   goldenBank?: object[],
 *   maxTraps?: number,
 *   maxFamilies?: number,
 * }} opts
 */
export function validateProposalBatch(rawBatch, opts) {
  const parsed = EvalImproveProposalBatchSchema.safeParse(rawBatch);
  if (!parsed.success) {
    return { ok: false, proposals: [], errors: [`schema: ${parsed.error.message}`] };
  }
  const trainMisses = opts.trainMisses || [];
  const goldenBank = opts.goldenBank || [];
  const trainIds = new Set(
    trainMisses
      .map((m) => Number(m?.query?.command_id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );
  const trainQueries = trainMisses.map((m) => m?.query?.query_text || '');
  const judgeReasons = trainMisses
    .map((m) => m?.judge?.reason || m?.reason || '')
    .filter(Boolean);
  const verbSet = new Set((opts.taxonomyVerbs || []).map(normVerb));
  const maxTraps = opts.maxTraps ?? EVAL_IMPROVE_MAX_TRAPS_PER_ROUND;
  const maxFamilies = opts.maxFamilies ?? EVAL_IMPROVE_MAX_FAMILIES_PER_ROUND;

  const accepted = [];
  const errors = [];
  let trapCount = 0;
  let familyCount = 0;

  for (const p of parsed.data.proposals) {
    if (p.kind === 'lexicon_trap') {
      if (trapCount >= maxTraps) {
        errors.push(`cap: skip trap role=${p.role}`);
        continue;
      }
      const prefer = normVerb(p.prefer_verb);
      if (verbSet.size && !verbSet.has(prefer)) {
        errors.push(`trap ${p.role}: prefer_verb not in taxonomy (${p.prefer_verb})`);
        continue;
      }
      const rawEvidence = [...new Set(p.evidence_command_ids.map(Number))];
      const nonTrain = rawEvidence.filter((id) => !trainIds.has(id));
      if (nonTrain.length) {
        errors.push(
          `trap ${p.role}: evidence ids not in train misses (banned displayed/wrong ids): ${nonTrain.join(',')}`,
        );
      }
      const evidence = rawEvidence.filter((id) => trainIds.has(id));
      const needles = [];
      let needlesOk = true;
      for (const needle of p.needles) {
        if (!trainQueries.some((q) => needleInQuery(needle, q))) {
          errors.push(`trap ${p.role}: needle "${needle}" matches no train query`);
          needlesOk = false;
          break;
        }
        if (needleCopiesJudgeReason(needle, judgeReasons)) {
          errors.push(`trap ${p.role}: needle copies judge reason`);
          needlesOk = false;
          break;
        }
        needles.push(needle);
      }
      if (!needlesOk) continue;

      const gen = trapEvidenceMeetsGenerality(evidence, needles, trainMisses);
      if (!gen.ok) {
        errors.push(
          `trap ${p.role}: need ≥2 train-miss command_ids or ≥2 needle-matched train queries (got ids=${evidence.length} matchedQueries=${gen.matchedQueries ?? 0})`,
        );
        continue;
      }

      accepted.push({
        ...p,
        prefer_verb: prefer.startsWith('git ') ? prefer : p.prefer_verb,
        evidence_command_ids: evidence,
        needles,
      });
      trapCount += 1;
      continue;
    }

    if (p.kind === 'verb_family') {
      if (familyCount >= maxFamilies) {
        errors.push(`cap: skip family canonical=${p.canonical}`);
        continue;
      }
      const canon = normVerb(p.canonical);
      const aliases = p.aliases.map(normVerb).filter(Boolean);
      if (verbSet.size) {
        if (!verbSet.has(canon)) {
          errors.push(`family: canonical not in taxonomy (${p.canonical})`);
          continue;
        }
        if (aliases.some((a) => !verbSet.has(a))) {
          errors.push(`family: alias not in taxonomy (${p.canonical})`);
          continue;
        }
      }
      let forbidden = false;
      for (const al of aliases) {
        if (isForbiddenVerbFamilyPair(canon, al)) {
          errors.push(
            `family: forbidden destructive/antonym pair (${p.canonical} ↔ ${al})`,
          );
          forbidden = true;
          break;
        }
      }
      if (forbidden) continue;

      const members = [canon, ...aliases];
      if (goldensDistinguishFamilyMembers(members, goldenBank)) {
        errors.push(
          `family: goldens distinguish members (${p.canonical} ↔ ${aliases.join(',')})`,
        );
        continue;
      }

      const rawEvidence = [...new Set(p.evidence_command_ids.map(Number))];
      const nonTrain = rawEvidence.filter((id) => !trainIds.has(id));
      if (nonTrain.length) {
        errors.push(
          `family ${p.canonical}: evidence ids not in train misses: ${nonTrain.join(',')}`,
        );
      }
      const evidence = rawEvidence.filter((id) => trainIds.has(id));
      if (evidence.length < 1) {
        errors.push(`family ${p.canonical}: need ≥1 train evidence command_id`);
        continue;
      }
      accepted.push({
        ...p,
        canonical: canon.startsWith('git ') ? canon : p.canonical,
        aliases: p.aliases,
        evidence_command_ids: evidence,
      });
      familyCount += 1;
    }
  }

  return { ok: true, proposals: accepted, errors };
}
