// @ts-nocheck
import { normalizeExample } from '../lib/validator.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from '../catalog/step0Glossary.js';
import {
  GoldenCaseRawSchema,
  migrateGoldenCaseWith,
  normalizeSkillBand as normalizeSkillBandFromSchema,
} from '../schemas/golden.js';

/**
 * Normalize a golden command/example string (placeholders ÔåÆ glossary).
 */
export function normalizeGoldenText(text, glossary = DEFAULT_GLOSSARY) {
  if (!text) return '';
  return normalizeExample(materializePlaceholders(String(text), glossary));
}

function listAcceptableCommands(c, glossary) {
  const raw = [c.expectedCommand, ...(c.acceptableCommands || [])].filter(Boolean);
  return [...new Set(raw.map((x) => normalizeGoldenText(x, glossary)))];
}

function listAcceptableExamples(c, glossary) {
  const raw = [
    c.expectedExample,
    c.expectedSimplestExample,
    c.expectedCommand,
    ...(c.acceptableExamples || []),
    ...(c.acceptableCommands || []),
  ].filter(Boolean);
  return [...new Set(raw.map((x) => normalizeGoldenText(x, glossary)))];
}

/**
 * Graded dual match: command + example, with optional preferSimplest.
 * Scores: 5 exact simplest; 4 acceptable non-simplest; 3 right command wrong example; 1 wrong.
 *
 * @returns {{ score: number, pass: boolean, passAt3: boolean, passAt5: boolean, rationale: string }}
 */
export function gradeCase(c, actual, glossary = DEFAULT_GLOSSARY) {
  const actualCommand = normalizeGoldenText(actual?.command || '', glossary);
  const actualExample = normalizeGoldenText(actual?.example || actual?.command || '', glossary);
  const actualRecipeId = String(actual?.recipe_id || actual?.id || '').trim();

  if (c.expectedRecipeId) {
    const okIds = [
      c.expectedRecipeId,
      ...(c.acceptableRecipeIds || []),
    ].map((x) => String(x).trim()).filter(Boolean);
    if (actualRecipeId && okIds.includes(actualRecipeId)) {
      return {
        score: 5,
        pass: true,
        passAt3: true,
        passAt5: true,
        rationale: 'expectedRecipeId match',
      };
    }
    // Fall through to example matching if id missing on actual (legacy rows)
  }

  const okCommands = listAcceptableCommands(c, glossary);
  const okExamples = listAcceptableExamples(c, glossary);
  const expectedSimplest = normalizeGoldenText(
    c.expectedSimplestExample || c.expectedExample || c.expectedCommand || '',
    glossary,
  );

  const commandOk = okCommands.some((x) => actualCommand === x
    || actualCommand.startsWith(x)
    || x.startsWith(actualCommand.split(/\s+/).slice(0, 2).join(' ')));
  const exampleOk = okExamples.some((x) => actualExample === x);

  // Soft: same git subcommand family
  const softCommand = actualCommand
    && okCommands.some((x) => x.split(/\s+/).slice(0, 2).join(' ') === actualCommand.split(/\s+/).slice(0, 2).join(' '));

  if (!actualCommand && !actualExample) {
    return {
      score: 1,
      pass: false,
      passAt3: false,
      passAt5: false,
      rationale: 'empty actual command',
    };
  }

  // Example match is primary for usability (may span command families).
  if (exampleOk) {
    const isSimplest = !expectedSimplest || actualExample === expectedSimplest;
    if (c.preferSimplest && !isSimplest) {
      return {
        score: 4,
        pass: false,
        passAt3: true,
        passAt5: false,
        rationale: 'acceptable but not simplest',
      };
    }
    return {
      score: isSimplest || !c.preferSimplest ? 5 : 4,
      pass: true,
      passAt3: true,
      passAt5: isSimplest || !c.preferSimplest,
      rationale: isSimplest ? 'exact simplest' : 'acceptable match',
    };
  }

  if (commandOk && exampleOk) {
    return {
      score: 5,
      pass: true,
      passAt3: true,
      passAt5: true,
      rationale: 'exact match',
    };
  }

  if (commandOk || softCommand) {
    return {
      score: 3,
      pass: false,
      passAt3: true,
      passAt5: false,
      rationale: 'right command family, wrong or missing example',
    };
  }

  return {
    score: 1,
    pass: false,
    passAt3: false,
    passAt5: false,
    rationale: 'wrong command',
  };
}

/**
 * Parse expectedSkillBand supporting ints and enum names; clamp old 5ÔåÆ4.
 */
export function normalizeSkillBand(band) {
  return normalizeSkillBandFromSchema(band);
}

/**
 * Enrich a golden case with example fields (migration helper).
 */
export function migrateGoldenCase(c, glossary = DEFAULT_GLOSSARY) {
  const raw = GoldenCaseRawSchema.parse(c);
  return migrateGoldenCaseWith(raw, (text) => normalizeGoldenText(text, glossary));
}
