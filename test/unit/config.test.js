import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig, readConfig, configFilePath } from '../../packages/core/src/lib/config.js';

describe('config', () => {
  it('writes and reads skill level', () => {
    writeConfig({ skillLevel: 3 });
    expect(readConfig().skillLevel).toBe(3);
    writeConfig({ skillLevel: null });
    expect(readConfig().skillLevel).toBe(null);
  });
});
