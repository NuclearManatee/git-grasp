#!/usr/bin/env bun
/**
 * CI audit gate: fail on high+ except known transitive sharp via transformers (no fix yet).
 */
import { execSync } from 'node:child_process';

let out = '';
try {
  out = execSync('npm audit --json', { encoding: 'utf8' });
} catch (e) {
  out = e.stdout?.toString?.() || e.stdout || '';
}

let report;
try {
  report = JSON.parse(out);
} catch {
  console.error('Could not parse npm audit JSON');
  process.exit(1);
}

const vulns = report.vulnerabilities || {};
const highs = Object.entries(vulns).filter(([, v]) => v.severity === 'high' || v.severity === 'critical');

const allowed = new Set(['sharp', '@huggingface/transformers']);
const unexpected = highs.filter(([name]) => !allowed.has(name));

if (unexpected.length) {
  console.error('Unexpected high/critical vulnerabilities:', unexpected.map(([n]) => n));
  process.exit(1);
}

if (highs.length) {
  console.warn('Allowed known advisories (track for fix):', highs.map(([n]) => n).join(', '));
}
console.log('Audit gate passed');
