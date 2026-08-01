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
  parseSkillLevel,
  skillName,
  sanitizeField,
  getOpenWebCatalog,
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

function previewLines() {
  return [
    'git-grasp web playground',
    '',
    '  $ git-grasp "undo last commit but keep my files"',
    '  git reset',
    '    ────────────────────────────',
    '    git reset --soft HEAD~1',
    '    ────────────────────────────',
    '',
    'Start the playground to download the embedding model and try live search.',
  ].join('\n');
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
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '120px', threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

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
      const term = termRef.current;
      if (!term) return;
      if (!line) {
        writePrompt();
        return;
      }

      if (line === 'help' || line === '?') {
        term.writeln('Commands:');
        term.writeln('  <query>              search (same as CLI)');
        term.writeln('  -v <query>           verbose search');
        term.writeln('  set-level <level>    non-technical|beginner|…|clear');
        term.writeln('  help                 this message');
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
          term.writeln(
            level == null
              ? 'skill filter cleared'
              : `skill filter ≤ ${skillName(level)}`,
          );
        } catch (e) {
          term.writeln(`\x1b[31m${sanitizeField(e.message || e)}\x1b[0m`);
        }
        writePrompt();
        return;
      }

      let verbose = false;
      let query = line;
      if (query.startsWith('-v ') || query.startsWith('--verbose ')) {
        verbose = true;
        query = query.replace(/^--?v(erbose)?\s+/, '');
      }

      busyRef.current = true;
      term.writeln('\x1b[2mSearching…\x1b[0m');
      const t0 = performance.now();
      try {
        const result = await searchBrowser(query, {
          forceMockEmbeddings: mockMode,
          skillLevelOverride: skillRef.current,
          onEmbedStatus: (msg) => term.writeln(`\x1b[2m${msg}\x1b[0m`),
        });
        const latency = Math.round(performance.now() - t0);
        forceAnsi();
        term.writeln(formatSearchResult(result, { verbose }));
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
        });
      } catch (e) {
        term.writeln(`\x1b[31m${sanitizeField(e.message || e)}\x1b[0m`);
        trackWebCliSearch({
          query,
          response: { status: 'error', error: sanitizeField(String(e.message || e)), code: e.code },
          latency_ms: Math.round(performance.now() - t0),
          mock: mockMode,
          connection: readConnection(),
          ...deviceInfo(),
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
      term?.clear();
      term?.writeln('Loading playground assets…');

      setStatus('Verifying catalog…');
      await ensureCatalog();

      setStatus(mockMode ? 'Using mock embeddings…' : 'Loading embedding model…');
      await searchBrowser('warmup', {
        forceMockEmbeddings: mockMode,
        skillLevelOverride: null,
        onEmbedStatus: (msg) => {
          setStatus(msg);
          term?.writeln(`\x1b[2m${msg}\x1b[0m`);
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
      });

      readyRef.current = true;
      setPhase('ready');
      setStatus('Ready');
      term?.clear();
      term?.writeln('git-grasp web — type a query, or \x1b[1mhelp\x1b[0m');
      if (mockMode) term?.writeln('\x1b[33m(mock embeddings)\x1b[0m');
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
                  for enabling search.
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
          Playground queries and results may be sent to cookieless analytics to improve search.
          Details on{' '}
          <a href="/privacy" className="text-gh-accent underline-offset-2 hover:underline">
            Privacy &amp; legal
          </a>
          . Prefer offline use with no remote telemetry?{' '}
          <a href="#install" className="text-gh-accent underline-offset-2 hover:underline">
            Install the CLI
          </a>{' '}
          (telemetry off by default; optional opt-in via <span className="font-mono">git-grasp telemetry</span>).
        </p>
      </div>
    </section>
  );
}
