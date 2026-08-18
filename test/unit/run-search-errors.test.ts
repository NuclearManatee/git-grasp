import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { readStdinQuery, runCliSearch } from '../../apps/cli/src/runSearch.js';
import { infoLine, errorLine, okLine, warnLine, style } from '../../common/src/ux/cliStyle.js';

let clipboardShouldFail = false;
mock.module('clipboardy', () => ({
  default: {
    write: async () => {
      if (clipboardShouldFail) throw new Error('clipboard unavailable');
    },
  },
}));

function deps(overrides = {}) {
  return {
    search: async () => ({ query: 'q', displayResults: [{ commands: [{ command: 'git status' }] }] }),
    formatSearchResult: () => 'formatted',
    formatSearchResultJson: () => ({ ok: true }),
    primaryCommand: () => 'git status',
    maybeInviteAndTrackSearch: async () => ({ tracked: false }),
    maybeNotifyUpdate: async () => ({ notified: false }),
    style,
    okLine,
    infoLine,
    warnLine,
    errorLine,
    msgSearchCopyOk: () => 'copied',
    msgSearchCopyFail: () => 'copy-fail',
    ora: () => ({ start() { return this; }, stop() {}, set text(_) {} }),
    ...overrides,
  };
}

describe('readStdinQuery', () => {
  it('returns empty on TTY and reads chunks otherwise', async () => {
    const origStdinTty = process.stdin.isTTY;
    try {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
      expect(await readStdinQuery()).toBe('');
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: origStdinTty });
    }
  });
});

describe('runCliSearch', () => {
  const errSpy = spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = spyOn(console, 'log').mockImplementation(() => {});
  const prevMock = process.env.GIT_GRASP_MOCK_EMBEDDINGS;
  const prevBench = process.env.GIT_GRASP_BENCH;

  beforeEach(() => {
    errSpy.mockClear();
    logSpy.mockClear();
    process.exitCode = 0;
    process.env.GIT_GRASP_MOCK_EMBEDDINGS = '1';
    delete process.env.GIT_GRASP_BENCH;
  });

  afterEach(() => {
    process.exitCode = 0;
    if (prevMock === undefined) delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;
    else process.env.GIT_GRASP_MOCK_EMBEDDINGS = prevMock;
    if (prevBench === undefined) delete process.env.GIT_GRASP_BENCH;
    else process.env.GIT_GRASP_BENCH = prevBench;
  });

  it('prints text result and tracks', async () => {
    const invite = mock(async () => ({ tracked: true }));
    await runCliSearch('q', { verbose: true }, deps({ maybeInviteAndTrackSearch: invite }));
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('formatted'))).toBe(true);
    expect(invite).toHaveBeenCalled();
  });

  it('prints JSON and skips invite', async () => {
    const invite = mock(async () => ({ tracked: true }));
    await runCliSearch('q', { json: true }, deps({ maybeInviteAndTrackSearch: invite }));
    expect(invite).not.toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0]).toContain('"ok": true');
  });

  it('prints bench breakdown', async () => {
    process.env.GIT_GRASP_BENCH = '1';
    await runCliSearch(
      'q',
      {},
      deps({
        search: async () => ({
          query: 'q',
          _bench: { total: 12.5, phases: { embed: 4, _t0: 1 } },
        }),
      }),
    );
    expect(errSpy.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/\[bench\]/);
  });

  it('copy success and clipboard failure', async () => {
    clipboardShouldFail = false;
    await runCliSearch('q', { copy: true }, deps({
      primaryCommand: () => 'git status',
      msgSearchCopyOk: undefined,
      msgSearchCopyFail: undefined,
    }));
    clipboardShouldFail = true;
    await runCliSearch('q', { copy: true }, deps({
      primaryCommand: () => 'git status',
      msgSearchCopyOk: undefined,
      msgSearchCopyFail: undefined,
    }));
    clipboardShouldFail = false;
    await runCliSearch('q', { copy: true }, deps({
      primaryCommand: () => null,
    }));
  });

  it('uses spinner embed status when stderr is TTY', async () => {
    const origStderrTty = process.stderr.isTTY;
    try {
      Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });
      const spinner = { text: '', start() { return this; }, stop() {} };
      await runCliSearch('q', {}, deps({
        ora: () => spinner,
        search: async (_q, opts) => {
          opts.onEmbedStatus('embedding');
          return { query: 'q', displayResults: [] };
        },
      }));
      expect(spinner.text).toBe('embedding');
    } finally {
      Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: origStderrTty });
    }
  });

  it('uses fallbacks without style helpers', async () => {
    await runCliSearch('q', {}, {
      search: async (_q, opts) => {
        opts.onEmbedStatus('embedding');
        return { query: 'q', displayResults: [] };
      },
      formatSearchResult: () => 'x',
      formatSearchResultJson: () => ({}),
      primaryCommand: () => 'git status',
      maybeInviteAndTrackSearch: async () => ({}),
      maybeNotifyUpdate: async () => ({}),
    });
  });

  it('appends doctor tip on INTEGRITY errors', async () => {
    const err = new Error('checksum mismatch');
    err.code = 'INTEGRITY';
    await runCliSearch('q', { quiet: true }, deps({
      search: async () => { throw err; },
    }));
    expect(process.exitCode).toBe(2);
    const joined = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(joined).toMatch(/checksum mismatch/);
    expect(joined).toMatch(/git-grasp doctor/);
  });

  it('maps CONFIG / VERSION / generic errors and json errors', async () => {
    const cfg = new Error('bad config');
    cfg.code = 'CONFIG';
    await runCliSearch('q', {}, deps({ search: async () => { throw cfg; } }));
    expect(process.exitCode).toBe(3);

    process.exitCode = 0;
    const ver = new Error('bad version');
    ver.code = 'VERSION';
    await runCliSearch('q', {}, deps({ search: async () => { throw ver; } }));
    expect(process.exitCode).toBe(5);

    process.exitCode = 0;
    await runCliSearch('q', {}, deps({ search: async () => { throw new Error('nope'); } }));
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    const integ = new Error('checksum');
    integ.code = 'CONFIG_INSECURE';
    await runCliSearch('q', { json: true }, deps({ search: async () => { throw integ; } }));
    expect(process.exitCode).toBe(3);
    expect(logSpy.mock.calls.at(-1)[0]).toContain('"status": "error"');
  });
});
