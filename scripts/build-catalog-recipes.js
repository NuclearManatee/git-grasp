#!/usr/bin/env bun
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { synthesizeRecipes } from '../packages/core/src/catalog/stepRecipes.js';
import { DEFAULT_GLOSSARY } from '../packages/core/src/catalog/step0Glossary.js';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';

const glossaryPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const recipes = synthesizeRecipes({ root: PACKAGE_ROOT, glossary });
const dir = path.join(PACKAGE_ROOT, 'data', 'catalog');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'recipes.raw.json');
writeFileSync(file, `${JSON.stringify(recipes, null, 2)}\n`);
console.log(`Wrote ${recipes.length} recipes → ${file}`);
