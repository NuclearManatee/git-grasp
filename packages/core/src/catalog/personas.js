import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../lib/paths.js';
import { SKILL_NAMES } from '../lib/skills.js';

/**
 * Load persona paragraphs from prompts/skill-personas.md.
 * @param {string} [root]
 * @returns {Record<number, string>}
 */
export function loadSkillPersonas(root = PACKAGE_ROOT) {
  const file = path.join(root, 'prompts', 'skill-personas.md');
  const fallback = {
    1: 'Non-technical user: colloquial, panicked, no jargon.',
    2: 'Beginner: basic Git nouns, clear tutorial phrasing.',
    3: 'Mid-level: efficient, flag-aware day-to-day Git.',
    4: 'Expert: terse, precise, Git-native vocabulary.',
  };
  if (!existsSync(file)) return fallback;

  const md = readFileSync(file, 'utf8');
  const sections = md.split(/^##\s+/m).slice(1);
  const out = { ...fallback };
  for (const section of sections) {
    const m = section.match(/^(\d+)\s*[—-]\s*([^\n]+)\n([\s\S]*)$/);
    if (!m) continue;
    const level = Number(m[1]);
    if (level < 1 || level > 4) continue;
    out[level] = section.replace(/^\d+\s*[—-][^\n]+\n/, '').trim();
  }
  return out;
}

export function personasPromptBlock(personas) {
  return SKILL_NAMES.map((name, i) => {
    const level = i + 1;
    return `### skill ${level} (${name})\n${personas[level] || ''}`;
  }).join('\n\n');
}
