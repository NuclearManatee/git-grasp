/**
 * Pure recipe command helpers (no bun:sqlite) — safe for Vitest.
 * Schema v6 steps use `command`; legacy `run` is accepted and normalized.
 */

/**
 * @param {unknown} commands
 * @returns {string}
 */
export function serializeCommands(commands) {
  if (typeof commands === 'string') return commands;
  if (commands && typeof commands === 'object' && Array.isArray(commands.commands)) {
    return JSON.stringify(commands);
  }
  return JSON.stringify(commands ?? []);
}

/**
 * Normalize a recipe JSON string or object into steps with both `command` and `run`.
 * @param {string | object | unknown} raw
 * @returns {Array<{ command: string, run: string, comment?: string }>}
 */
export function parseCommands(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (arr && typeof arr === 'object' && Array.isArray(arr.commands)) {
    arr = arr.commands;
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((c) => {
      const command = String(c?.command ?? c?.run ?? '').trim();
      return {
        command,
        run: command,
        comment: String(c?.comment ?? '').trim(),
      };
    })
    .filter((c) => c.command);
}

/**
 * @param {Array<{ command?: string, run?: string, comment?: string }> | string | object} commands
 */
export function renderSnippet(commands) {
  const steps = parseCommands(commands);
  return steps
    .map((s) => {
      const comment = s.comment ? `  # ${s.comment}` : '';
      return `${s.command}${comment}`;
    })
    .join('\n');
}

/**
 * @param {object} recipe
 * @returns {string}
 */
export function serializeCommandRecipe(recipe) {
  if (typeof recipe === 'string') return recipe;
  const steps = parseCommands(recipe?.commands ? recipe : { commands: recipe });
  return JSON.stringify({
    commands: steps.map((s) => ({
      command: s.command,
      comment: s.comment || '',
    })),
  });
}

/**
 * @param {object | string} recipe
 */
export function primaryCommand(recipe) {
  const steps = parseCommands(
    typeof recipe === 'string' || recipe?.commands ? recipe : { commands: recipe },
  );
  return steps[0]?.command || '';
}
