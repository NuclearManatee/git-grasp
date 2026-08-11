// @ts-nocheck
/**
 * Read a natural-language query from stdin when piped (non-TTY).
 * @returns {Promise<string>}
 */
export async function readStdinQuery() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
  }
  return chunks.join('').trim();
}

/**
 * Shared search runner used by Commander and the bin fast path.
 */
export async function runCliSearch(query, opts, deps) {
  const {
    search,
    formatSearchResult,
    formatSearchResultJson,
    primaryCommand,
    maybeInviteAndTrackSearch,
    maybeNotifyUpdate,
    style,
    okLine,
    infoLine,
    warnLine,
    errorLine,
    msgSearchCopyOk,
    msgSearchCopyFail,
    ora,
  } = deps;

  const muted = (s) => (style ? style.muted(s) : s);
  const toOk = (s) => (okLine ? okLine(s) : muted(s));
  const toWarn = (s) => (warnLine ? warnLine(s) : s);
  const toErr = (s) => (errorLine ? errorLine(s) : s);
  const toInfo = (s) => (infoLine ? infoLine(s) : muted(s));
  const copyOk = () => (msgSearchCopyOk ? msgSearchCopyOk() : toOk('Copied command to clipboard.'));
  const copyFail = () =>
    (msgSearchCopyFail
      ? msgSearchCopyFail()
      : toWarn('Clipboard unavailable — command is printed above.'));

  const verbose = Boolean(opts.verbose);
  const quiet = Boolean(opts.quiet);
  const asJson = Boolean(opts.json);
  const mock = process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1';
  const useSpinner =
    !quiet
    && !asJson
    && Boolean(process.stderr.isTTY)
    && process.env.GIT_GRASP_BENCH !== '1';
  const spinner = useSpinner && ora ? ora('Searching…').start() : null;
  const t0 = performance.now();

  try {
    const result = await search(query, {
      forceMockEmbeddings: mock,
      onEmbedStatus: (msg) => {
        if (spinner) spinner.text = msg;
        else if (!quiet && !asJson && process.stderr.isTTY) console.error(msg);
      },
    });
    spinner?.stop();

    if (asJson) {
      console.log(JSON.stringify(formatSearchResultJson(result), null, 2));
    } else {
      console.log(formatSearchResult(result, { verbose }));
    }

    if (process.env.GIT_GRASP_BENCH === '1' && result._bench) {
      const { total, phases } = result._bench;
      const parts = Object.entries(phases)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => `${k}=${Number(v).toFixed(1)}ms`)
        .join(' ');
      console.error(muted(`[bench] total=${total.toFixed(1)}ms ${parts}`));
    }

    if (opts.copy) {
      const cmd = primaryCommand(result);
      if (cmd) {
        try {
          const clipboardy = await import('clipboardy');
          await clipboardy.default.write(cmd);
          if (!quiet && !asJson) {
            console.error(copyOk());
          }
        } catch {
          if (!quiet) {
            console.error(copyFail());
          }
        }
      }
    }

    if (!asJson) {
      await maybeInviteAndTrackSearch({
        query: result.query || query,
        result,
        latencyMs: Math.round(performance.now() - t0),
        mock,
        verbose,
        skipInvite: quiet,
      });
    }

    await maybeNotifyUpdate({ quiet: quiet || asJson });
  } catch (err) {
    spinner?.stop();
    const code = err.code;
    if (asJson) {
      console.log(JSON.stringify({
        status: 'error',
        error: String(err.message || err),
        code: code || null,
      }, null, 2));
    } else {
      console.error(toErr(err.message));
      if (code === 'INTEGRITY' || code === 'CONFIG' || code === 'CONFIG_INSECURE' || code === 'VERSION') {
        console.error(toInfo('Run git-grasp doctor if this keeps happening.'));
      }
    }
    if (code === 'INTEGRITY') process.exitCode = 2;
    else if (code === 'CONFIG' || code === 'CONFIG_INSECURE') process.exitCode = 3;
    else if (code === 'VERSION') process.exitCode = 5;
    else process.exitCode = 1;

    if (!asJson) {
      await maybeInviteAndTrackSearch({
        query,
        error: err,
        latencyMs: Math.round(performance.now() - t0),
        mock,
        verbose,
        skipInvite: quiet,
      });
    }
  }
}
