import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCliSearch } from '../../apps/cli/src/runSearch.js';
import { infoLine, errorLine } from '../../common/src/ux/cliStyle.js';

describe('runCliSearch hard-error tip', () => {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    errSpy.mockClear();
    logSpy.mockClear();
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = 0;
  });

  it('appends doctor tip on INTEGRITY errors', async () => {
    const err = new Error('checksum mismatch');
    err.code = 'INTEGRITY';
    await runCliSearch('q', { quiet: true }, {
      search: async () => { throw err; },
      formatSearchResult: () => '',
      formatSearchResultJson: () => ({}),
      primaryCommand: () => null,
      maybeInviteAndTrackSearch: async () => ({}),
      maybeNotifyUpdate: async () => ({}),
      errorLine,
      infoLine,
    });
    expect(process.exitCode).toBe(2);
    const joined = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(joined).toMatch(/checksum mismatch/);
    expect(joined).toMatch(/git-grasp doctor/);
  });
});
