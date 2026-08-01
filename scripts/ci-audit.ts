#!/usr/bin/env bun
// @ts-nocheck
/**
 * CI audit gate: fail on high/critical. Prefer empty allowlist.
 * Uses `bun audit --json` (package ÔåÆ advisory[] map).
 */
import { execFileSync } from 'node:child_process';

let out = '';
try {
  // Prefer the same bun binary that launched this script (PATH may omit bun).
  out = execFileSync(process.execPath, ['audit', '--json'], { encoding: 'utf8' });
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

/** @type {Array<[string, { severity?: string, title?: string, id?: string }]>} */
const findings = [];
for (const [name, advisories] of Object.entries(report)) {
  if (!Array.isArray(advisories)) continue;
  for (const adv of advisories) {
    findings.push([name, adv]);
  }
}

const highs = findings.filter(([, v]) => v.severity === 'high' || v.severity === 'critical');

/** @type {Set<string>} Temporary exceptions only ÔÇö keep empty when possible. */
const allowed = new Set();

const unexpected = highs.filter(([name]) => !allowed.has(name));

if (unexpected.length) {
  console.error(
    'Unexpected high/critical vulnerabilities:',
    unexpected.map(([n, a]) => `${n} (${a.title || a.id || a.severity})`),
  );
  process.exit(1);
}

if (highs.length) {
  console.warn(
    'Allowed known advisories (must bump soon):',
    highs.map(([n, a]) => `${n}:${a.id || a.title || a.severity}`).join(', '),
  );
}
console.log('Audit gate passed');
