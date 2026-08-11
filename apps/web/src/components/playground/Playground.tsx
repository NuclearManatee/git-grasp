// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import chalk from 'chalk';
import {
  openWebCatalog,
  searchBrowser,
  formatSearchResult,
  primaryCommand,
  parseSkillLevel,
  sanitizeField,
  getOpenWebCatalog,
  SCHEMA_VERSION,
  msgTelemetryOn,
  msgTelemetryOffPlayground,
  msgTelemetryStatusPlayground,
  msgSkillCleared,
  msgSkillSet,
  msgInitWarm,
  msgInitWarmMock,
  msgInitReady,
  msgSearchCopyOk,
  msgSearchCopyFail,
  infoLine,
  warnLine,
  errorLine,
} from '@git-grasp/common/browser';
import {
  WEB_PACK_BYTES,
  WEB_PACK_SHA256,
  WEB_CATALOG_URL,
  MODEL_BYTES_ESTIMATE,
  MODEL_DOWNLOAD_LABEL,
  PLAYGROUND_DOWNLOAD_LABEL,
} from '../../lib/assetSizes.js';
import { shouldAutoLoadPlayground, readConnection, deviceInfo } from '../../lib/connection.js';
import { trackWebCliLoad, trackWebCliSearch } from '../../lib/umami.js';

const SKILL_KEY = 'git-grasp.skillLevel';
const PACK_URL = typeof WEB_CATALOG_URL === 'string' ? WEB_CATALOG_URL : '/catalog/web-catalog.db';

function forceAnsi() {
  chalk.level = 3;
}

/** Static preview aligned with formatSearchResult / search-exact layout. */
function previewLines() {
  return [
    'git-grasp web playground',
    '',
    '  $ git-grasp "undo last commit but keep my files"',
    '',
    'git reset --soft HEAD~1',
    '  git reset --soft HEAD~1  # keep changes',
    '  ────────────────────────────────────',
    '  git reset --soft HEAD~1',
    '  Undo commit, keep index & worktree',
    '  ────────────────────────────────────',
    'Undo the last commit but keep your files',
    '',
    'Start the playground to download assets and try live search.',
  ].join('\n');
}

function playgroundHelp() {
  return [
    'Common commands:',
    '  <query>                 search (same ranking as CLI)',
    '  -v / --verbose <query>  verbose scores',
    '  -c / --copy <query>     copy winning command',
    '  set-level <level>       store preferred skill (parked; no retrieval effect)',
    '  telemetry status        show telemetry (on after Start)',
    '  help                    this message',
    '',
    'CLI-only: doctor, update-check, completion, config, init',
  ].join('\n');
}

function catalogTrackMeta() {
  const cat = getOpenWebCatalog();
  return {
    schema_version: cat?.schemaVersion ?? SCHEMA_VERSION,
    catalog_version: cat?.catalogVersion ?? null,
  };
}

function dumpTerminalBuffer(term) {
  if (!term?.buffer?.active) return '';
  const buf = term.buffer.active;
  const lines = [];
  for (let i = 0; i < buf.length; i += 1) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n').replace(/\s+$/gm, '').trim();
}

/**
 * @param {{ forceMock?: boolean, forceOptIn?: boolean }} props
 */
export default function Playground({ forceMock = false, forceOptIn = false }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const lineBuf = useRef('');
  const busyRef = useRef(false);
  const skillRef = useRef(/** @type {number | null} */ (null));
  const readyRef = useRef(false);
  const packPrefetchRef = useRef(/** @type {Promise<void> | null} */ (null));

  const [phase, setPhase] = useState(/** @type {'idle'|'overlay'|'loading'|'ready'|'error'} */ ('idle'));
  const [status, setStatus] = useState('');
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [inView, setInView] = useState(false);
  const [packReady, setPackReady] = useState(false);

  const mockMode =
    forceMock
    || (typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('mock') === '1');

  const downloadLabel = packReady && !mockMode
    ? MODEL_DOWNLOAD_LABEL
    : mockMode
      ? `~${Math.ceil((WEB_PACK_BYTES || 0) / (1024 * 1024))} MB`
      : PLAYGROUND_DOWNLOAD_LABEL;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SKILL_KEY);
      if (raw != null && raw !== '') skillRef.current = Number(raw);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const el = document.getElementById('playground');
    if (!el) {
      setInView(true);
      return undefined;
    }

    // Hash / deep-link / already-visible: don't wait for IO (can miss after late island mount).
    const hashTargets =
      typeof window !== 'undefined'
      && (window.location.hash === '#playground' || forceOptIn
        || new URLSearchParams(window.location.search).get('optin') === '1');
    const rect = el.getBoundingClientRect();
    const alreadyVisible =
      rect.top < window.innerHeight + 120 && rect.bottom > -120;
    if (hashTargets || alreadyVisible) {
      setInView(true);
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '120px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [forceOptIn]);

  const writePrompt = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    term.write('\r\n\x1b[32mgit-grasp\x1b[0m> ');
  }, []);

  const ensureTerminal = useCallback(() => {
    if (termRef.current || !hostRef.current) return termRef.current;
    forceAnsi();
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: 13,
      theme: {
        background: '#0f1419',
        foreground: '#e7ecf1',
        cursor: '#3d9a6a',
        selectionBackground: '#2a3544',
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    if (typeof window !== 'undefined') {
      window.__ghPlaygroundDump = () => dumpTerminalBuffer(termRef.current);
    }

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    term.onData((data) => {
      if (!readyRef.current || busyRef.current) return;
      for (const ch of data) {
        if (ch === '\r') {
          const line = lineBuf.current.trim();
          lineBuf.current = '';
          term.write('\r\n');
          void handleCommand(line);
        } else if (ch === '\u007f') {
          if (lineBuf.current.length > 0) {
            lineBuf.current = lineBuf.current.slice(0, -1);
            term.write('\b \b');
          }
        } else if (ch >= ' ' || ch === '\t') {
          lineBuf.current += ch;
          term.write(ch);
        }
      }
    });

    return term;

    async function handleCommand(line) {
      const t = termRef.current;
      if (!t) return;
      if (!line) {
        writePrompt();
        return;
      }

      forceAnsi();

      if (line === 'help' || line === '?') {
        t.writeln(playgroundHelp());
        writePrompt();
        return;
      }

      if (line.startsWith('telemetry')) {
        const arg = line.slice('telemetry'.length).trim().toLowerCase() || 'status';
        if (arg === 'on') {
          t.writeln(msgTelemetryOn());
        } else if (arg === 'off') {
          t.writeln(msgTelemetryOffPlayground());
        } else if (arg === 'status') {
          t.writeln(msgTelemetryStatusPlayground());
        } else {
          t.writeln(errorLine('Usage: telemetry on|off|status'));
        }
        writePrompt();
        return;
      }

      if (line.startsWith('set-level')) {
        const arg = line.slice('set-level'.length).trim() || 'clear';
        try {
          const level = parseSkillLevel(arg);
          skillRef.current = level;
          try {
            if (level == null) localStorage.removeItem(SKILL_KEY);
            else localStorage.setItem(SKILL_KEY, String(level));
          } catch {
            /* ignore */
          }
          t.writeln(level == null ? msgSkillCleared() : msgSkillSet(level));
        } catch (e) {
          t.writeln(errorLine(sanitizeField(e.message || e)));
        }
        writePrompt();
        return;
      }

      let verbose = false;
      let copy = false;
      let query = line;
      const flagRe = /^(?:(-v|--verbose)|(-c|--copy))\s+/;
      while (flagRe.test(query)) {
        const m = query.match(flagRe);
        if (m[1]) verbose = true;
        if (m[2]) copy = true;
        query = query.replace(flagRe, '');
      }
      query = query.trim();
      if (!query) {
        t.writeln(errorLine('Usage: [-v|--verbose] [-c|--copy] <query>'));
        writePrompt();
        return;
      }

      busyRef.current = true;
      t.writeln(infoLine('Searching…'));
      const t0 = performance.now();
      try {
        const result = await searchBrowser(query, {
          forceMockEmbeddings: mockMode,
          skillLevelOverride: skillRef.current,
          onEmbedStatus: (msg) => t.writeln(infoLine(msg)),
        });
        const latency = Math.round(performance.now() - t0);
        forceAnsi();
        t.writeln(formatSearchResult(result, { verbose }));

        if (copy) {
          const cmd = primaryCommand(result);
          if (cmd) {
            try {
              await navigator.clipboard.writeText(cmd);
              t.writeln(msgSearchCopyOk());
            } catch {
              t.writeln(msgSearchCopyFail());
            }
          }
        }

        trackWebCliSearch({
          query: result.query,
          response: {
            status: result.status,
            confidence: result.confidence,
            results: (result.results || []).map((r) => ({
              id: r.id,
              command: r.command,
              example: r.example,
              score: r.score,
              skill_level: r.skill_level,
            })),
            advanced: result.advanced
              ? { id: result.advanced.id, example: result.advanced.example }
              : null,
          },
          latency_ms: latency,
          mock: mockMode,
          connection: readConnection(),
          ...deviceInfo(),
          ...catalogTrackMeta(),
        });
      } catch (e) {
        t.writeln(errorLine(sanitizeField(e.message || e)));
        trackWebCliSearch({
          query,
          response: { status: 'error', error: sanitizeField(String(e.message || e)), code: e.code },
          latency_ms: Math.round(performance.now() - t0),
          mock: mockMode,
          connection: readConnection(),
          ...deviceInfo(),
          ...catalogTrackMeta(),
        });
      } finally {
        busyRef.current = false;
        writePrompt();
      }
    }
  }, [mockMode, writePrompt]);

  const ensureCatalog = useCallback(async () => {
    if (getOpenWebCatalog()) {
      setPackReady(true);
      return;
    }
    if (!WEB_PACK_SHA256 || !/^[a-fA-F0-9]{64}$/.test(WEB_PACK_SHA256)) {
      throw new Error('Catalog integrity constant missing (WEB_PACK_SHA256)');
    }
    if (!packPrefetchRef.current) {
      packPrefetchRef.current = (async () => {
        const packRes = await fetch(PACK_URL);
        if (!packRes.ok) throw new Error(`Failed to fetch catalog (${packRes.status})`);
        const packBuf = new Uint8Array(await packRes.arrayBuffer());
        await openWebCatalog(packBuf, { expectedSha256: WEB_PACK_SHA256 });
        setPackReady(true);
      })().catch((err) => {
        packPrefetchRef.current = null;
        throw err;
      });
    }
    await packPrefetchRef.current;
  }, []);

  const loadAssets = useCallback(async () => {
    setPhase('loading');
    setError(null);
    setStatus(packReady ? 'Loading embedding model…' : 'Downloading catalog…');
    const t0 = performance.now();
    const conn = readConnection();
    const device = deviceInfo();

    try {
      ensureTerminal();
      const term = termRef.current;
      forceAnsi();
      term?.clear();
      term?.writeln(infoLine('Loading playground assets…'));

      setStatus('Verifying catalog…');
      await ensureCatalog();

      setStatus(mockMode ? 'Using mock embeddings…' : 'Loading embedding model…');
      term?.writeln(mockMode ? msgInitWarmMock() : msgInitWarm());
      await searchBrowser('warmup', {
        forceMockEmbeddings: mockMode,
        skillLevelOverride: null,
        onEmbedStatus: (msg) => {
          setStatus(msg);
          term?.writeln(infoLine(msg));
        },
      }).catch(() => {
        /* warmup may return low confidence — fine */
      });

      const duration = Math.round(performance.now() - t0);
      const bytes = (WEB_PACK_BYTES || 0) + (mockMode ? 0 : MODEL_BYTES_ESTIMATE);
      trackWebCliLoad({
        duration_ms: duration,
        bytes,
        pack_bytes: WEB_PACK_BYTES,
        outcome: 'ok',
        mock: mockMode,
        connection: conn,
        ...device,
        ...catalogTrackMeta(),
      });

      readyRef.current = true;
      setPhase('ready');
      setStatus('Ready');
      forceAnsi();
      term?.clear();
      term?.writeln(msgInitReady());
      term?.writeln(msgTelemetryOn());
      term?.writeln(infoLine('Type a query, or help'));
      if (mockMode) term?.writeln(warnLine('(mock embeddings)'));
      writePrompt();
      term?.focus();
    } catch (e) {
      const duration = Math.round(performance.now() - t0);
      trackWebCliLoad({
        duration_ms: duration,
        bytes: WEB_PACK_BYTES + (mockMode ? 0 : MODEL_BYTES_ESTIMATE),
        outcome: 'error',
        error: sanitizeField(String(e.message || e)),
        mock: mockMode,
        connection: conn,
        ...device,
        ...catalogTrackMeta(),
      });
      setError(sanitizeField(e.message || String(e)));
      setPhase('error');
      setStatus('Failed to load');
    }
  }, [ensureCatalog, ensureTerminal, mockMode, packReady, writePrompt]);

  useEffect(() => {
    if (!inView || phase !== 'idle') return;
    setPhase('overlay');
    ensureTerminal();
    const term = termRef.current;
    term?.clear();
    term?.writeln(previewLines());

    // Catalog-only prefetch on good links (never auto-download the model).
    const wantOptIn =
      forceOptIn
      || (typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).get('optin') === '1');
    const conn = readConnection();
    if (!wantOptIn && shouldAutoLoadPlayground(conn)) {
      setStatus('Prefetching catalog…');
      void ensureCatalog()
        .then(() => setStatus('Catalog ready — start to enable search'))
        .catch(() => setStatus(''));
    }
  }, [inView, phase, forceOptIn, ensureTerminal, ensureCatalog]);

  return (
    <section
      id="playground"
      className="gh-container py-16 sm:py-20"
      aria-labelledby="playground-heading"
      data-testid="playground"
    >
      <div className="mb-8 max-w-xl">
        <h2 id="playground-heading" className="font-mono text-2xl font-semibold sm:text-3xl">
          Playground
        </h2>
        <p className="mt-3 text-gh-muted">
          Live in-browser search — same ranking as the CLI. Runs locally in your tab after
          assets load.
        </p>
      </div>

      <div className="gh-panel relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-gh-border px-4 py-2">
          <span className="font-mono text-xs text-gh-muted">web cli</span>
          <span className="font-mono text-xs text-gh-muted" aria-live="polite">
            {status || phase}
          </span>
        </div>

        <div
          ref={hostRef}
          className="h-[22rem] w-full bg-gh-bg p-2"
          role="application"
          aria-label="git-grasp interactive terminal"
          data-testid="playground-terminal"
        />

        {(phase === 'overlay' || phase === 'error') && (
          <div
            className="absolute inset-x-0 top-9 bottom-12 flex flex-col items-center justify-center gap-4 bg-gh-bg/90 p-6 text-center backdrop-blur-sm"
            data-testid="playground-overlay"
          >
            {phase === 'overlay' && (
              <>
                <button
                  type="button"
                  className="gh-btn-primary"
                  data-testid="playground-start"
                  onClick={() => void loadAssets()}
                >
                  Start playground
                </button>
                <p className="max-w-sm text-sm text-gh-muted">
                  Will download{' '}
                  <strong className="text-gh-fg">{downloadLabel}</strong>
                  {' '}
                  for enabling search. Starting enables cookieless analytics (see Privacy).
                </p>
              </>
            )}
            {phase === 'error' && (
              <>
                <p className="max-w-sm text-sm text-gh-danger" role="alert">
                  {error}
                </p>
                <button
                  type="button"
                  className="gh-btn-secondary"
                  onClick={() => void loadAssets()}
                >
                  Retry
                </button>
              </>
            )}
          </div>
        )}

        {phase === 'loading' && (
          <div
            className="pointer-events-none absolute inset-x-0 top-9 bottom-12 flex items-center justify-center bg-gh-bg/50"
            data-testid="playground-loading"
          >
            <p className="rounded border border-gh-border bg-gh-panel px-4 py-2 font-mono text-sm text-gh-fg">
              {status || 'Loading…'}
            </p>
          </div>
        )}

        <p className="border-t border-gh-border px-4 py-2.5 text-xs leading-relaxed text-gh-muted">
          Playground telemetry is on after Start — queries and results will be sent to cookieless
          analytics to improve search. Details on{' '}
          <a href="/privacy" className="text-gh-accent underline-offset-2 hover:underline">
            Privacy &amp; legal
          </a>
          .
          <br />
          Prefer offline use with no remote telemetry?{' '}
          <a href="#install" className="text-gh-accent underline-offset-2 hover:underline">
            Install the CLI
          </a>{' '}
          (telemetry off by default; optional opt-in via <span className="font-mono">git-grasp telemetry</span>).
        </p>
      </div>
    </section>
  );
}
