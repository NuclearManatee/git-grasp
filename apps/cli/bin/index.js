#!/usr/bin/env bun
/**
 * Fast path for bare `git-help <query…>` — avoid loading commander until needed.
 */
const args = process.argv.slice(2);
const known = new Set(['search', 'set-level', 'doctor', 'help', '-h', '--help', '-V', '--version']);

function isFlag(a) {
  return a === '-v' || a === '--verbose' || a === '-c' || a === '--copy';
}

const first = args[0];
const useFast = args.length > 0
  && !known.has(first)
  && !(first?.startsWith('-') && !isFlag(first));

if (useFast) {
  const { search, formatSearchResult, primaryCommand } = await import('@git-help/core/cli');
  const verbose = args.includes('-v') || args.includes('--verbose');
  const copy = args.includes('-c') || args.includes('--copy');
  const query = args.filter((a) => !isFlag(a)).join(' ').trim();
  if (!query) {
    const { buildProgram } = await import('../src/program.js');
    buildProgram().outputHelp();
    process.exit(0);
  }
  try {
    const useSpinner = Boolean(process.stderr.isTTY) && process.env.GIT_HELP_BENCH !== '1';
    let spinner = null;
    if (useSpinner) {
      const ora = (await import('ora')).default;
      spinner = ora('Searching…').start();
    }
    const result = await search(query, {
      forceMockEmbeddings: process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
      onEmbedStatus: (msg) => {
        if (spinner) spinner.text = msg;
      },
    });
    spinner?.stop();
    console.log(formatSearchResult(result, { verbose }));
    if (process.env.GIT_HELP_BENCH === '1' && result._bench) {
      const { total, phases } = result._bench;
      const parts = Object.entries(phases)
        .map(([k, v]) => `${k}=${Number(v).toFixed(1)}ms`)
        .join(' ');
      console.error(`[bench] total=${total.toFixed(1)}ms ${parts}`);
    }
    if (copy) {
      const cmd = primaryCommand(result);
      if (cmd) {
        try {
          const clipboardy = await import('clipboardy');
          await clipboardy.default.write(cmd);
          console.error('Copied example to clipboard');
        } catch {
          console.error('Clipboard unavailable; example printed above');
        }
      }
    }
  } catch (err) {
    console.error(err.message || err);
    const code = err.code;
    if (code === 'INTEGRITY') process.exit(2);
    if (code === 'CONFIG') process.exit(3);
    if (code === 'FILTER_EMPTY') process.exit(4);
    process.exit(1);
  }
} else {
  const { buildProgram } = await import('../src/program.js');
  const program = buildProgram();
  await program.parseAsync(process.argv);
}
