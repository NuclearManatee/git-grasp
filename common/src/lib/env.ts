// @ts-nocheck
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from './paths.js';
import { getProvider, resolveProviderId } from './providers.js';
import { parseLlmEnv } from '../schemas/env.js';

let loaded = false;

/** Load .env for maintainer scripts only ÔÇö never call from search path. */
export function loadEnv() {
  if (loaded) return;
  const envPath = path.join(PACKAGE_ROOT, '.env');
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
  parseLlmEnv();
  loaded = true;
}

export function requireProviderKey(providerId = null) {
  loadEnv();
  const provider = getProvider(providerId);
  const key = process.env[provider.envKey];
  if (!key) {
    throw new Error(`${provider.envKey} missing (set in environment or .env)`);
  }
  return key;
}

/** Resolve the configured provider and require its API key. */
export function requireLlmKey(providerId = null) {
  return requireProviderKey(providerId ?? resolveProviderId());
}

export function requireDeepSeekKey() {
  return requireProviderKey('deepseek');
}
