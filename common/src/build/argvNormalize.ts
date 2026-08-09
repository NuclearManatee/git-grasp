// @ts-nocheck
/**
 * Canonical argv normalization for recipe identity + display diversity.
 *
 * Goal: `git config user.email "<email>"` and
 * `git config user.email "you@example.com"` share one structural fingerprint.
 */
import { createHash } from 'node:crypto';
import { parseCommands } from '../db/recipeFormat.js';

/** Demo / glossary literals that should collapse to typed slots. */
const LITERAL_TO_SLOT = new Map([
  ['you@example.com', 'email'],
  ['me@example.com', 'email'],
  ['user@example.com', 'email'],
  ['sandbox@git-grasp.local', 'email'],
  ['git-grasp-sandbox', 'name'],
  ['feature', 'branch'],
  ['main', 'branch'], // careful: often a real flag arg — only as standalone token after branchy verbs
  ['master', 'branch'],
  ['notes.txt', 'file'],
  ['other.txt', 'file'],
  ['readme.md', 'file'],
  ['renamed.txt', 'file'],
  ['subdir', 'directory'],
  ['demo', 'directory'],
  ['origin', 'remote'],
  ['v1.0.0', 'tag'],
  ['update', 'message'],
  ['init', 'message'],
  ['seed', 'message'],
  ['https://example.com/repo.git', 'url'],
  ['http://example.com/repo.git', 'url'],
  ['head~1', 'commit'],
  ['head~3', 'commit'],
]);

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const URL_RE = /^(https?|git|ssh):\/\//i;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const VERSION_TAG_RE = /^v?\d+\.\d+(\.\d+)?([-\w.]+)?$/i;
const PATHY_RE = /\.(txt|md|js|ts|json|yml|yaml|py|rb|go|rs|c|h|cpp)$/i;

/** Verbs where a following non-flag token is typically a branch/ref name. */
const BRANCHY_VERBS = new Set([
  'branch',
  'checkout',
  'switch',
  'merge',
  'rebase',
  'push',
  'pull',
  'fetch',
  'reset',
  'tag',
]);

/** Flags whose next argv token is a value slot. */
const VALUE_FLAGS = new Set([
  '-m',
  '--message',
  '-C',
  '--author',
  '--date',
  '-u',
  '--set-upstream-to',
  '--onto',
  '-b',
  '-B',
  '--branch',
  '--file',
  '-f', // ambiguous; only treat as value when not boolean force context — keep conservative
]);

function stripQuotes(tok) {
  const s = String(tok || '');
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function slotForLiteral(raw) {
  const unquoted = stripQuotes(raw).trim();
  if (!unquoted) return null;
  if (/^<[^>]+>$/.test(unquoted)) return null; // already placeholder
  const lower = unquoted.toLowerCase();
  if (LITERAL_TO_SLOT.has(lower)) return LITERAL_TO_SLOT.get(lower);
  if (EMAIL_RE.test(unquoted)) return 'email';
  if (URL_RE.test(unquoted) || unquoted.includes('example.com')) return 'url';
  if (SHA_RE.test(unquoted)) return 'commit';
  if (VERSION_TAG_RE.test(unquoted) && /[0-9]/.test(unquoted)) return 'tag';
  if (PATHY_RE.test(unquoted) || unquoted.includes('/') || unquoted.includes('\\')) {
    return 'file';
  }
  // author "Name <email>" blobs
  if (/^.+\s<[^>]+@$/.test(unquoted) || /^.+\s<.+@.+$/.test(unquoted)) {
    return 'author';
  }
  return null;
}

/**
 * Tokenize a simple git command line (same spirit as sandbox tokenize).
 */
export function tokenizeArgv(line) {
  const out = [];
  let cur = '';
  let quote = null;
  const s = String(line || '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function primaryVerb(tokens) {
  // git [-C path] [-c key=val]* <verb>
  let i = 0;
  if ((tokens[0] || '').toLowerCase() === 'git') i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '-C' || t === '-c') {
      i += 2;
      continue;
    }
    if (t.startsWith('-')) {
      i += 1;
      continue;
    }
    return { verb: t.toLowerCase(), index: i };
  }
  return { verb: '', index: -1 };
}

/**
 * Structural normalization of one command line for identity / display.
 * Placeholders and demo literals → `<slot>`.
 */
export function normalizeArgvLine(line) {
  const tokens = tokenizeArgv(line);
  if (!tokens.length) return '';
  const { verb, index: verbIdx } = primaryVerb(tokens);
  const out = [];
  let expectValue = null; // slot name forced by previous flag

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const lower = tok.toLowerCase();

    if (expectValue) {
      out.push(`<${expectValue}>`);
      expectValue = null;
      continue;
    }

    // Already a placeholder
    if (/^<[^>]+>$/.test(tok)) {
      out.push(tok.toLowerCase().replace(/^<(.+)>$/, (_, k) => `<${k}>`));
      continue;
    }

    // Flags: keep name; mark value-taking flags
    if (tok.startsWith('-') && tok !== '-') {
      out.push(lower);
      // --author=Name or -m=msg
      const eq = tok.indexOf('=');
      if (eq > 0) {
        // already consumed as single token with = — rewrite value part
        const flag = tok.slice(0, eq).toLowerCase();
        const val = tok.slice(eq + 1);
        const slot = slotForLiteral(val) || 'value';
        out[out.length - 1] = `${flag}=<${slot}>`;
        continue;
      }
      if (VALUE_FLAGS.has(lower) || VALUE_FLAGS.has(tok)) {
        // -m / --message / --author take next token
        if (lower === '-m' || lower === '--message') expectValue = 'message';
        else if (lower === '--author') expectValue = 'author';
        else if (lower === '-b' || lower === '-B' || lower === '--branch') {
          expectValue = 'branch';
        } else if (lower === '--onto') expectValue = 'commit';
        else if (lower === '-u' || lower === '--set-upstream-to') {
          expectValue = 'remote';
        } else if (lower === '-C') expectValue = 'path';
        else if (lower === '-c') expectValue = 'config';
        else expectValue = 'value';
      }
      continue;
    }

    // After config key path: git config user.email <email>
    if (verb === 'config' && i > verbIdx) {
      if (tok.includes('.') && !tok.includes('@')) {
        out.push(lower); // keep config key
        // peek: next token is the value — handled next iteration via expect? 
        continue;
      }
      // value token: type from previous key when possible
      const prev = out[out.length - 1] || '';
      let slot = slotForLiteral(tok);
      if (!slot) {
        if (/\.email$/i.test(prev)) slot = 'email';
        else if (/\.name$/i.test(prev)) slot = 'name';
        else slot = 'value';
      }
      out.push(`<${slot}>`);
      continue;
    }

    // Branchy positional args
    if (BRANCHY_VERBS.has(verb) && i > verbIdx) {
      const slot = slotForLiteral(tok);
      if (slot) {
        out.push(`<${slot}>`);
        continue;
      }
      // bare name that isn't a known flag → branch/ref slot
      if (!tok.startsWith('-') && !/^(head|origin|upstream)$/i.test(tok)) {
        out.push('<branch>');
        continue;
      }
    }

    const slot = slotForLiteral(tok);
    if (slot) {
      out.push(`<${slot}>`);
      continue;
    }

    out.push(lower);
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Rewrite demo literals into `<slot>` placeholders (canonical store form).
 */
export function rewriteLiteralsToPlaceholders(line) {
  const tokens = tokenizeArgv(line);
  if (!tokens.length) return String(line || '');
  const { verb, index: verbIdx } = primaryVerb(tokens);
  const out = [];
  let expectValue = null;

  const quoteIfNeeded = (slot) => `<${slot}>`;

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const lower = tok.toLowerCase();

    if (expectValue) {
      out.push(quoteIfNeeded(expectValue));
      expectValue = null;
      continue;
    }

    if (/^<[^>]+>$/.test(tok)) {
      out.push(tok);
      continue;
    }

    if (tok.startsWith('-') && tok !== '-') {
      const eq = tok.indexOf('=');
      if (eq > 0) {
        const flag = tok.slice(0, eq);
        const val = tok.slice(eq + 1);
        const slot = slotForLiteral(val) || 'value';
        out.push(`${flag}=<${slot}>`);
        continue;
      }
      out.push(tok);
      if (lower === '-m' || lower === '--message') expectValue = 'message';
      else if (lower === '--author') expectValue = 'author';
      else if (lower === '-b' || lower === '-B' || lower === '--branch') {
        expectValue = 'branch';
      } else if (lower === '--onto') expectValue = 'commit';
      else if (lower === '-u' || lower === '--set-upstream-to') {
        expectValue = 'remote';
      } else if (lower === '-C') expectValue = 'path';
      else if (lower === '-c') expectValue = 'config';
      continue;
    }

    if (verb === 'config' && i > verbIdx) {
      if (tok.includes('.') && !tok.includes('@')) {
        out.push(tok);
        continue;
      }
      const prev = out[out.length - 1] || '';
      let slot = slotForLiteral(tok);
      if (!slot) {
        if (/\.email$/i.test(prev)) slot = 'email';
        else if (/\.name$/i.test(prev)) slot = 'name';
        else slot = 'value';
      }
      out.push(quoteIfNeeded(slot));
      continue;
    }

    if (BRANCHY_VERBS.has(verb) && i > verbIdx && !tok.startsWith('-')) {
      const slot = slotForLiteral(tok) || 'branch';
      if (
        slot === 'branch' ||
        slot === 'file' ||
        slot === 'remote' ||
        slot === 'tag' ||
        slot === 'commit' ||
        slot === 'url'
      ) {
        out.push(quoteIfNeeded(slot));
        continue;
      }
    }

    const slot = slotForLiteral(tok);
    if (slot) {
      out.push(quoteIfNeeded(slot));
      continue;
    }

    out.push(tok);
  }

  return out.join(' ');
}

/**
 * True if the line uses a demo literal that should be a `<placeholder>`.
 */
export function needsPlaceholderRewrite(line) {
  const original = String(line || '').trim().replace(/\s+/g, ' ');
  const rewritten = rewriteLiteralsToPlaceholders(original).replace(/\s+/g, ' ');
  return rewritten !== original;
}

export function normalizeCommands(commands) {
  return parseCommands(commands).map((s) => ({
    ...s,
    command: normalizeArgvLine(s.command),
  }));
}

export function rewriteCommandsPlaceholders(commands) {
  return parseCommands(commands).map((s) => ({
    ...s,
    command: rewriteLiteralsToPlaceholders(s.command),
    comment: s.comment,
  }));
}

/**
 * Structural fingerprint (shared by DB identity + display diversity).
 */
export function structuralCommandFingerprint(commands) {
  const steps = parseCommands(commands);
  const norm = steps
    .map((s) => normalizeArgvLine(s.command))
    .filter(Boolean)
    .join('\n');
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

/** Display / diversify key (normalized argv text, not hashed). */
export function structuralRecipeKey(commandsOrHit) {
  if (
    commandsOrHit &&
    typeof commandsOrHit === 'object' &&
    !Array.isArray(commandsOrHit)
  ) {
    if (Array.isArray(commandsOrHit.commands)) {
      return normalizeCommands(commandsOrHit.commands)
        .map((s) => s.command)
        .filter(Boolean)
        .join('\n');
    }
    const line = commandsOrHit.example || commandsOrHit.command || '';
    return normalizeArgvLine(line);
  }
  return normalizeCommands(commandsOrHit)
    .map((s) => s.command)
    .filter(Boolean)
    .join('\n');
}
