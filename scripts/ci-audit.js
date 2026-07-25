#!/usr/bin/env bun
/**
 * CI audit gate: fail on high+ except known transitive / stub deps (track for fix).
 * Uses `bun audit --json` (package → advisory[] map).
 */
import { execSync } from 'node:child_process';

let out = '';
try {
  out = execSync('bun audit --json', { encoding: 'utf8' });
} catch (e) {
  out = e.stdout?.toString?.() || e.stdout || '';
}

let report;
try {
  // bun may print a version banner line before JSON
  const start = out.indexOf('{');
  report = JSON.parse(start >= 0 ? out.slice(start) : out);
} catch {
  console.error('Could not parse bun audit JSON');
  process.exit(1);
}

/** @type {Array<[string, { severity?: string }]>} */
const findings = [];
for (const [name, advisories] of Object.entries(report)) {
  if (!Array.isArray(advisories)) continue;
  for (const adv of advisories) {
    findings.push([name, adv]);
  }
}

const highs = findings.filter(([, v]) => v.severity === 'high' || v.severity === 'critical');

const allowed = new Set([
  'sharp',
  '@huggingface/transformers',
  'astro', // web stub; bump when interactive search ships
]);
const unexpected = highs.filter(([name]) => !allowed.has(name));

if (unexpected.length) {
  console.error(
    'Unexpected high/critical vulnerabilities:',
    unexpected.map(([n, a]) => `${n} (${a.title || a.id || a.severity})`),
  );
  process.exit(1);
}

if (highs.length) {
  console.warn('Allowed known advisories (track for fix):', highs.map(([n]) => n).join(', '));
}
console.log('Audit gate passed');
