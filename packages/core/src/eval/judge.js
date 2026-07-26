import { normalizeExample } from '../lib/validator.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from '../catalog/step0Glossary.js';
import { coerceSkillBandValue } from '../lib/skills.js';

/**
 * Normalize a golden command/example string (placeholders → glossary).
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
 * Parse expectedSkillBand supporting ints and enum names; clamp old 5→4.
 */
export function normalizeSkillBand(band) {
  if (!Array.isArray(band) || band.length === 0) return [1, 4];
  return band.map((v) => {
    try {
      return coerceSkillBandValue(v);
    } catch {
      const n = Number(v);
      if (n === 5) return 4;
      return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 2;
    }
  });
}

/**
 * Enrich a golden case with example fields (migration helper).
 */
export function migrateGoldenCase(c, glossary = DEFAULT_GLOSSARY) {
  const expectedCommand = c.expectedCommand
    ? normalizeGoldenText(c.expectedCommand, glossary).split(/\s+/).slice(0, 2).join(' ')
    : '';
  const expectedExample = normalizeGoldenText(
    c.expectedExample || c.expectedCommand || '',
    glossary,
  );
  const acceptableExamples = [
    ...(c.acceptableExamples || []),
    ...(c.acceptableCommands || []),
  ].map((x) => normalizeGoldenText(x, glossary));
  const preferSimplest = c.preferSimplest !== false;
  return {
    ...c,
    expectedCommand: c.expectedCommand?.includes('<')
      ? expectedCommand
      : (c.expectedCommand?.split(/\s+/).length > 2
        ? c.expectedCommand.split(/\s+/).slice(0, 2).join(' ')
        : c.expectedCommand),
    expectedExample,
    acceptableCommands: (c.acceptableCommands || [c.expectedCommand]).map((x) => {
      const n = normalizeGoldenText(x, glossary);
      return n.split(/\s+/).slice(0, 2).join(' ');
    }),
    acceptableExamples: [...new Set(acceptableExamples.filter(Boolean))],
    expectedSimplestExample: normalizeGoldenText(
      c.expectedSimplestExample || expectedExample,
      glossary,
    ),
    preferSimplest,
    expectedSkillBand: normalizeSkillBand(c.expectedSkillBand),
  };
}
