/**
 * Load + Mustache-render frontmatter multi-message prompt markdown.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Mustache from 'mustache';
import { PACKAGE_ROOT } from './paths.js';

/** @typedef {{ role: 'system' | 'user' | 'assistant', content: string }} ChatMessage */

/** @type {Map<string, { meta: Record<string, string>, sections: Record<string, string>, source: string }>} */
const cache = new Map();

/** @type {Record<string, string> | null} */
let partialsCache = null;

export function promptsDir() {
  const a = path.join(PACKAGE_ROOT, 'packages', 'core', 'prompts');
  if (existsSync(a)) return a;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../prompts');
}

function partialsDir() {
  return path.join(promptsDir(), 'partials');
}

function promptFilePath(id) {
  const normalized = String(id || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.md$/i, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error(`Invalid prompt id: ${id}`);
  }
  return path.join(promptsDir(), `${normalized}.md`);
}

/** Simple `key: value` frontmatter (no nested YAML). */
export function parseFrontmatter(raw) {
  const text = String(raw ?? '');
  if (!text.startsWith('---')) {
    return { meta: {}, body: text };
  }
  const end = text.indexOf('\n---', 3);
  if (end < 0) {
    return { meta: {}, body: text };
  }
  const fm = text.slice(3, end).replace(/^\r?\n/, '');
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, body };
}

/**
 * Split markdown body on ## system / ## user / ## assistant headings.
 * @param {string} body
 * @returns {Record<string, string>}
 */
export function splitRoleSections(body) {
  const text = String(body ?? '').replace(/^\uFEFF/, '');
  /** @type {Record<string, string>} */
  const sections = {};
  const matches = [...text.matchAll(/^##\s+(system|user|assistant)\s*$/gim)];
  if (!matches.length) {
    return sections;
  }
  for (let i = 0; i < matches.length; i += 1) {
    const role = matches[i][1].toLowerCase();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    sections[role] = text.slice(start, end).replace(/^\r?\n/, '').replace(/\s+$/, '');
  }
  return sections;
}

function loadPartials() {
  if (partialsCache) return partialsCache;
  /** @type {Record<string, string>} */
  const out = {};
  const dir = partialsDir();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const key = name.replace(/\.md$/i, '');
      out[key] = readFileSync(path.join(dir, name), 'utf8').replace(/\s+$/, '');
    }
  }
  partialsCache = out;
  return out;
}

function parsePromptFile(id) {
  const filePath = promptFilePath(id);
  if (!existsSync(filePath)) {
    throw new Error(`Prompt not found: ${id} (${filePath})`);
  }
  const source = readFileSync(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(source);
  const sections = splitRoleSections(body);
  if (!Object.keys(sections).length) {
    throw new Error(`Prompt ${id} has no ## system / ## user sections (${filePath})`);
  }
  return { meta, sections, source };
}

function getParsed(id) {
  const key = String(id).replace(/\\/g, '/').replace(/\.md$/i, '');
  if (cache.has(key)) return cache.get(key);
  const parsed = parsePromptFile(key);
  cache.set(key, parsed);
  return parsed;
}

/** Clear in-process caches (tests). */
export function clearPromptCache() {
  cache.clear();
  partialsCache = null;
}

/** Raw markdown source for a prompt id. */
export function loadPromptSource(id) {
  return getParsed(id).source;
}

/**
 * Render a prompt template into chat messages.
 * @param {string} id e.g. `build/judge`
 * @param {object} [vars]
 * @returns {{ id: string, messages: ChatMessage[], meta: Record<string, string> }}
 */
export function renderPrompt(id, vars = {}) {
  const parsed = getParsed(id);
  const partials = loadPartials();
  const order = ['system', 'user', 'assistant'];
  /** @type {ChatMessage[]} */
  const messages = [];
  for (const role of order) {
    const tpl = parsed.sections[role];
    if (tpl == null) continue;
    const content = Mustache.render(tpl, vars, partials).replace(/\s+$/, '');
    messages.push({ role, content });
  }
  if (!messages.length) {
    throw new Error(`Prompt ${id} rendered zero messages`);
  }
  return {
    id: parsed.meta.id || String(id),
    messages,
    meta: parsed.meta,
  };
}

/** Render a single role section (e.g. system-only export for logging). */
export function renderPromptRole(id, role, vars = {}) {
  const parsed = getParsed(id);
  const tpl = parsed.sections[role];
  if (tpl == null) {
    throw new Error(`Prompt ${id} missing ## ${role} section`);
  }
  return Mustache.render(tpl, vars, loadPartials()).replace(/\s+$/, '');
}
