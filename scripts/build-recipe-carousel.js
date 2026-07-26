#!/usr/bin/env bun
/**
 * Build a self-contained local HTML carousel of catalog recipes (CLI-style preview).
 * Output: local/recipe-carousel.html (gitignored via local/)
 *
 *   bun scripts/build-recipe-carousel.js
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';

const recipesPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.json');
const recipes = JSON.parse(readFileSync(recipesPath, 'utf8'));

function parseUsage(usage, fallback) {
  const raw = String(usage || '').trim();
  if (!raw) return { commandLine: fallback || '', blurb: '' };
  const parts = raw.split(/\n/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { commandLine: parts[0], blurb: parts.slice(1).join(' ') };
  if (/^git(\s|$)/.test(parts[0])) return { commandLine: parts[0], blurb: '' };
  return { commandLine: fallback || '', blurb: parts[0] || '' };
}

const payload = recipes.map((r) => ({
  id: r.id,
  title: r.title || r.command,
  command: r.command,
  topic: r.topic || '',
  source: r.source || '',
  family: r.intent_family || '',
  simplicity: r.simplicity_rank ?? 1,
  explanation: r.explanation || '',
  steps: Array.isArray(r.commands)
    ? r.commands.map((c) => ({ run: c.run, comment: c.comment || '' }))
    : [{ run: r.primary_example || r.command || '', comment: '' }],
  usage: parseUsage(r.usage, r.primary_example),
  primary: r.primary_example || '',
}));

const dataJson = JSON.stringify(payload).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>git-help recipe carousel</title>
<style>
  :root {
    --bg: #0f1419;
    --panel: #1a2332;
    --text: #e7ecf3;
    --muted: #8b9bb4;
    --cyan: #6ec6ff;
    --accent: #c3e88d;
    --border: #2a3548;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: radial-gradient(1200px 600px at 20% -10%, #1b2738, var(--bg));
    color: var(--text);
    display: flex;
    flex-direction: column;
  }
  header {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
  }
  header h1 { font-size: 1rem; font-weight: 600; margin: 0; }
  header .meta { color: var(--muted); font-size: 0.85rem; }
  .controls {
    margin-left: auto;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  button {
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.45rem 0.75rem;
    cursor: pointer;
    font: inherit;
  }
  button:hover { border-color: var(--cyan); }
  button:disabled { opacity: 0.4; cursor: default; }
  input[type="search"] {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 0.45rem 0.7rem;
    min-width: 14rem;
    font: inherit;
  }
  main {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 1.5rem;
  }
  .card {
    width: min(720px, 100%);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.25rem 1.35rem 1.5rem;
    box-shadow: 0 18px 50px rgba(0,0,0,0.35);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.9rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .tag {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
  }
  .title {
    font-size: 1.05rem;
    font-weight: 700;
    margin: 0 0 0.85rem;
  }
  .cli {
    white-space: pre-wrap;
    line-height: 1.45;
    font-size: 0.92rem;
  }
  .cli .run { color: var(--cyan); }
  .cli .comment { color: var(--muted); }
  .cli .rule { color: var(--muted); }
  .cli .blurb { color: var(--text); }
  .cli .intent { color: var(--accent); margin-top: 0.75rem; }
  .explanation {
    margin-top: 1rem;
    padding-top: 0.9rem;
    border-top: 1px dashed var(--border);
    color: var(--muted);
    font-size: 0.85rem;
    white-space: pre-wrap;
  }
  footer {
    padding: 0.75rem 1.25rem 1.25rem;
    color: var(--muted);
    font-size: 0.8rem;
    text-align: center;
  }
  kbd {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
    background: #121821;
  }
</style>
</head>
<body>
  <header>
    <h1>git-help · CLI preview</h1>
    <div class="meta" id="counter">—</div>
    <div class="controls">
      <input id="q" type="search" placeholder="Filter title / command / topic" />
      <button id="prev" type="button" title="Previous (Left arrow)">← Prev</button>
      <button id="next" type="button" title="Next (Right arrow)">Next →</button>
    </div>
  </header>
  <main>
    <article class="card" id="card">
      <div class="tags" id="tags"></div>
      <h2 class="title" id="title"></h2>
      <div class="cli" id="cli"></div>
      <div class="explanation" id="explanation"></div>
    </article>
  </main>
  <footer>Use <kbd>←</kbd> <kbd>→</kbd> or buttons. Embedded snapshot of recipes.json.</footer>
<script>
const RECIPES = ${dataJson};
let filtered = RECIPES.slice();
let index = 0;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function snippetHtml(steps) {
  return (steps || []).map((step) => {
    const run = esc(step.run || '');
    const comment = step.comment ? esc('  # ' + step.comment) : '';
    return '  <span class="run">' + run + '</span>' +
      (comment ? '<span class="comment">' + comment + '</span>' : '');
  }).join('\\n');
}

function render() {
  const elCounter = document.getElementById('counter');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  if (!filtered.length) {
    elCounter.textContent = '0 / 0';
    document.getElementById('title').textContent = 'No matches';
    document.getElementById('tags').innerHTML = '';
    document.getElementById('cli').textContent = '';
    document.getElementById('explanation').textContent = '';
    prev.disabled = next.disabled = true;
    return;
  }
  index = Math.max(0, Math.min(index, filtered.length - 1));
  const r = filtered[index];
  elCounter.textContent = (index + 1) + ' / ' + filtered.length + '  ·  ' + RECIPES.length + ' total';
  prev.disabled = index <= 0;
  next.disabled = index >= filtered.length - 1;

  document.getElementById('tags').innerHTML = [
    r.command && ('<span class="tag">' + esc(r.command) + '</span>'),
    r.topic && ('<span class="tag">' + esc(r.topic) + '</span>'),
    r.family && ('<span class="tag">' + esc(r.family) + '</span>'),
    r.source && ('<span class="tag">' + esc(r.source) + '</span>'),
    '<span class="tag">simplicity ' + esc(r.simplicity) + '</span>',
  ].filter(Boolean).join('');

  document.getElementById('title').textContent = r.title;

  const width = Math.max(28, Math.min(56, Math.max((r.usage.commandLine || '').length, (r.usage.blurb || '').length) + 2));
  const rule = '  ' + '─'.repeat(width);
  let cli = '';
  cli += '<div>' + snippetHtml(r.steps) + '</div>\\n';
  cli += '<div class="rule">' + esc(rule) + '</div>\\n';
  cli += '<div class="run">  ' + esc(r.usage.commandLine || r.primary) + '</div>\\n';
  if (r.usage.blurb) cli += '<div class="blurb">  ' + esc(r.usage.blurb) + '</div>\\n';
  cli += '<div class="rule">' + esc(rule) + '</div>\\n';
  cli += '<div class="intent">' + esc(r.primary) + '</div>';
  document.getElementById('cli').innerHTML = cli;
  document.getElementById('explanation').textContent = r.explanation || '';
}

function applyFilter() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  filtered = !q ? RECIPES.slice() : RECIPES.filter((r) =>
    [r.title, r.command, r.topic, r.family, r.source, r.primary, ...(r.steps || []).flatMap((s) => [s.run, s.comment])]
      .join(' ').toLowerCase().includes(q)
  );
  index = 0;
  render();
}

document.getElementById('prev').onclick = () => { index -= 1; render(); };
document.getElementById('next').onclick = () => { index += 1; render(); };
document.getElementById('q').addEventListener('input', applyFilter);
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.id === 'q') return;
  if (e.key === 'ArrowLeft') { index -= 1; render(); }
  if (e.key === 'ArrowRight') { index += 1; render(); }
});

render();
</script>
</body>
</html>
`;

const outDir = path.join(PACKAGE_ROOT, 'local');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'recipe-carousel.html');
writeFileSync(out, html);
console.log(`Wrote ${out} (${payload.length} recipes)`);
