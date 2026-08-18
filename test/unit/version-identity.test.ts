import { describe, it, expect } from 'bun:test';
import {
  appVersion,
  catalogIdentity,
  formatVersionReport,
  collectVersionIdentity,
  resetAppVersionCacheForTests,
} from '../../common/src/lib/version.js';
import { SCHEMA_VERSION } from '../../common/src/db/constants.js';

describe('version identity', () => {
  it('appVersion returns a semver-like string', () => {
    const v = appVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('catalogIdentity reads recipes.latest.json when present', () => {
    const cat = catalogIdentity();
    // Shipped catalog should have a version in this repo
    if (cat.corpusVersion != null) {
      expect(cat.corpusVersion).toBeGreaterThan(0);
      expect(cat.recipeCount).toBeGreaterThan(0);
    }
  });

  it('formatVersionReport includes app name and schema', () => {
    const text = formatVersionReport();
    expect(text).toContain('git-grasp');
    expect(text).toContain(`schema v${SCHEMA_VERSION}`);
  });

  it('collectVersionIdentity exposes schemaVersion', () => {
    const id = collectVersionIdentity();
    expect(id.schemaVersion).toBe(SCHEMA_VERSION);
    expect(id.appVersion).toBeTruthy();
  });

  it('appVersion honors npm_package_version then cache', () => {
    resetAppVersionCacheForTests();
    process.env.npm_package_version = '9.9.9-test';
    expect(appVersion()).toBe('9.9.9-test');
    expect(appVersion()).toBe('9.9.9-test');
    delete process.env.npm_package_version;
    resetAppVersionCacheForTests();
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
