#!/usr/bin/env bun
// @ts-nocheck
/**
 * Fast path for bare `git-grasp <query…>` — avoid loading commander until needed.
 */
const args = process.argv.slice(2);
const known = new Set([
  'search',
  'set-level',
  'doctor',
  'help',
  'telemetry',
  'config',
  'update-check',
  'init',
  'completion',
  '-h',
  '--help',
  '-V',
  '--version',
]);

function isFlag(a) {
  return a === '-v' || a === '--verbose'
    || a === '-c' || a === '--copy'
    || a === '--json'
    || a === '-q' || a === '--quiet';
}

const first = args[0];
const useFast = args.length > 0
  && !known.has(first)
  && !(first?.startsWith('-') && !isFlag(first));

if (args.includes('-V') || args.includes('--version')) {
  const { formatVersionReport } = await import('@git-grasp/common/cli');
  console.log(formatVersionReport());
  process.exit(0);
}

if (useFast) {
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
  } = await import('@git-grasp/common/cli');
  const ora = (await import('ora')).default;
  const { runCliSearch } = await import('../src/runSearch.js');

  const verbose = args.includes('-v') || args.includes('--verbose');
  const copy = args.includes('-c') || args.includes('--copy');
  const json = args.includes('--json');
  const quiet = args.includes('-q') || args.includes('--quiet');
  const query = args.filter((a) => !isFlag(a)).join(' ').trim();
  if (!query) {
    const { buildProgram } = await import('../src/program.js');
    buildProgram().outputHelp();
    process.exit(0);
  }
  await runCliSearch(query, { verbose, copy, json, quiet }, {
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
    ora,
  });
  process.exit(process.exitCode ?? 0);
} else {
  const { runProgram } = await import('../src/program.js');
  await runProgram(process.argv);
  process.exit(process.exitCode ?? 0);
}
