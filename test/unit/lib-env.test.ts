import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  loadEnv,
  requireProviderKey,
  requireLlmKey,
  requireDeepSeekKey,
} from '../../common/src/lib/env.ts';
import { parseLlmEnv } from '../../common/src/schemas/env.ts';

describe('lib/env', () => {
  const keys = ['DEEPSEEK_API_KEY', 'GIT_GRASP_LLM_PROVIDER'];
  const saved = {};

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('parseLlmEnv accepts process env', () => {
    expect(parseLlmEnv({ GIT_GRASP_LLM_PROVIDER: 'deepseek' }).GIT_GRASP_LLM_PROVIDER).toBe(
      'deepseek',
    );
  });

  it('loadEnv is idempotent and require* need a key', () => {
    loadEnv();
    loadEnv();
    process.env.DEEPSEEK_API_KEY = 'k';
    expect(requireProviderKey('deepseek')).toBe('k');
    expect(requireLlmKey()).toBe('k');
    expect(requireDeepSeekKey()).toBe('k');
    delete process.env.DEEPSEEK_API_KEY;
    expect(() => requireProviderKey('deepseek')).toThrow(/DEEPSEEK_API_KEY missing/);
  });
});
