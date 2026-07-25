#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../src/lib/paths.js';

const out = path.join(PACKAGE_ROOT, 'local', 'eval', 'dynamic');
mkdirSync(out, { recursive: true });
const cases = [
  { id: 'dyn-typo-01', query: 'git stauts', note: 'typo' },
  { id: 'dyn-slang-01', query: 'yeet my changes into the void', note: 'slang destructive' },
];
writeFileSync(path.join(out, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`);
console.log(`Wrote ${cases.length} dynamic stubs to ${out} (not auto-promoted)`);
