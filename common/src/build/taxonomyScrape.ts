// @ts-nocheck
/**
 * Parse `git help -a` text into Main Porcelain + Ancillary taxonomy.
 * Keeps only the first three sections; stops at "Interacting with Others".
 */

export const TAXONOMY_SECTION_NAMES = [
  'Main Porcelain Commands',
  'Ancillary Commands / Manipulators',
  'Ancillary Commands / Interrogators',
];

const STOP_SECTION = 'Interacting with Others';

/**
 * @param {string} text raw `git help -a` stdout
 * @returns {{ sections: { name: string, commands: { name: string, summary: string, command: string }[] }[], commands: { name: string, summary: string, command: string, section: string }[] }}
 */
export function parseGitHelpAll(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  /** @type {{ name: string, commands: { name: string, summary: string, command: string }[] }[]} */
  const sections = [];
  /** @type {{ name: string, commands: { name: string, summary: string, command: string }[] } | null} */
  let current = null;
  let pastIntro = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (TAXONOMY_SECTION_NAMES.includes(trimmed)) {
      pastIntro = true;
      current = { name: trimmed, commands: [] };
      sections.push(current);
      continue;
    }

    if (trimmed === STOP_SECTION || trimmed.startsWith('Low-level Commands')) {
      break;
    }

    if (!pastIntro || !current) continue;

    // "   add                     Add file contents..."
    const m = trimmed.match(/^([a-z][a-z0-9._-]*)\s{2,}(.+)$/i);
    if (!m) continue;
    const name = m[1];
    const summary = m[2].trim();
    current.commands.push({
      name,
      summary,
      command: `git ${name}`,
    });
  }

  const commands = sections.flatMap((s) =>
    s.commands.map((c) => ({ ...c, section: s.name })),
  );

  return { sections, commands };
}

/**
 * @param {{ sections: ReturnType<typeof parseGitHelpAll>['sections'], scraped_at?: string }} opts
 */
export function buildGitCommandsTaxonomy(opts) {
  const { sections } = opts;
  const commands = sections.flatMap((s) =>
    s.commands.map((c) => ({ ...c, section: s.name })),
  );
  return {
    version: 1,
    scraped_at: opts.scraped_at || new Date().toISOString(),
    sections,
    commands,
  };
}

/**
 * Embed text for a taxonomy anchor.
 * Includes the short `git help -a` summary when present.
 * @param {string} command e.g. `git commit`
 * @param {string} [summary]
 */
export function taxonomyEmbedText(command, summary = '') {
  const base = `[command] ${command}`;
  const s = (summary || '').trim();
  return s ? `${base}\n${s}` : base;
}
