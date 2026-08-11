import { describe, it, expect } from 'vitest';
import {
  buildCliOptInEvent,
  buildCliSearchEvent,
} from '../../common/src/lib/telemetry/events.js';
import { SCHEMA_VERSION } from '../../common/src/db/constants.js';
import { catalogIdentity } from '../../common/src/lib/version.js';

describe('telemetry events catalog fields', () => {
  it('cli_opt_in includes catalog_version and schema_version', () => {
    const ev = buildCliOptInEvent();
    expect(ev.name).toBe('cli_opt_in');
    expect(ev.data.schema_version).toBe(SCHEMA_VERSION);
    expect(ev.data).toHaveProperty('catalog_version');
    const cat = catalogIdentity();
    expect(ev.data.catalog_version).toBe(cat.corpusVersion);
  });

  it('cli_search includes catalog_version and schema_version', () => {
    const ev = buildCliSearchEvent({
      query: 'test',
      response: { status: 'ok' },
      latency_ms: 12,
      mock: true,
    });
    expect(ev.name).toBe('cli_search');
    expect(ev.data.schema_version).toBe(SCHEMA_VERSION);
    expect(ev.data).toHaveProperty('catalog_version');
    expect(ev.data.app_version).toBeTruthy();
  });
});
