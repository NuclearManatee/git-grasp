import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from './paths.js';

let loaded = false;

/** Load .env for maintainer scripts only — never call from search path. */
export function loadEnv() {
  if (loaded) return;
  const envPath = path.join(PACKAGE_ROOT, '.env');
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
  loaded = true;
}

export function requireGroqKey() {
  loadEnv();
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error('GROQ_API_KEY missing (set in environment or .env)');
  }
  return key;
}
