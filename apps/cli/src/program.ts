// @ts-nocheck
import { Command } from 'commander';
import ora from 'ora';
import {
  search,
  formatSearchResult,
  formatSearchResultJson,
  primaryCommand,
  writeConfig,
  readConfig,
  configFilePath,
  parseSkillLevel,
  SKILL_NAMES,
  SKILL_MIN,
  SKILL_MAX,
  maybeInviteAndTrackSearch,
  isHardOff,
  setTelemetryEnabled,
  telemetryStatusDetail,
  buildCliOptInEvent,
  sendUmamiEvent,
  formatVersionReport,
  maybeNotifyUpdate,
  setUpdateCheckEnabled,
  updateCheckStatusDetail,
  checkForUpdate,
  completionScript,
  getEmbedder,
  style,
  statusLine,
  okLine,
  infoLine,
  warnLine,
  errorLine,
  msgTelemetryOn,
  msgTelemetryOff,
  msgTelemetryStatusBlock,
  msgSkillCleared,
  msgSkillSet,
  msgInitWarm,
  msgInitWarmMock,
  msgInitReady,
  msgUpdateOn,
  msgUpdateOff,
  msgSearchCopyOk,
  msgSearchCopyFail,
} from '@git-grasp/common/cli';
import { runCliSearch, readStdinQuery } from './runSearch.js';

const HELP_INTRO = `Semantic search for Git commands (never runs Git for you).

Common commands:
  git-grasp "undo last commit keep files"
  git-grasp doctor
  git-grasp init
  git-grasp config show
  git-grasp telemetry status
  git-grasp update-check status
  git-grasp completion bash

Full reference: docs/cli.md`;

const SEARCH_DEPS = {
  search,
  formatSearchResult,
  formatSearchResultJson,
  primaryCommand,
  maybeInviteAndTrackSearch,
  maybeNotifyUpdate,
  style,
  errorLine,
  infoLine,
  warnLine,
  okLine,
  msgSearchCopyOk,
  msgSearchCopyFail,
  ora,
};

const ROOT_COMMANDS = new Set([
  'search',
  'set-level',
  'doctor',
  'help',
  'telemetry',
  'config',
  'update-check',
  'init',
  'completion',
]);

function searchOptions(cmd) {
  return cmd
    .option('-v, --verbose', 'show skill label, confidence, and channel scores')
    .option('-c, --copy', 'copy winning example to clipboard')
    .option('--json', 'print machine-readable JSON on stdout')
    .option('-q, --quiet', 'suppress spinner and non-essential stderr');
}

function runSearchCommand(program) {
  return async (queryParts, opts) => {
    let query = (queryParts || []).join(' ').trim();
    if (!query) {
      query = await readStdinQuery();
    }
    if (!query) {
      program.help();
      return;
    }
    await runCliSearch(query, opts, SEARCH_DEPS);
  };
}

export function buildProgram() {
  const program = new Command();
  program
    .name('git-grasp')
    .description(HELP_INTRO)
    .helpOption('-h, --help', 'display help')
    .option('-V, --version', 'show app + catalog identity');

  searchOptions(
    program
      .command('search')
      .description('Search for a Git command')
      .argument('[query...]', 'natural language query'),
  ).action(runSearchCommand(program));

  program
    .command('set-level')
    .description(
      `[deprecated/parked] Store preferred skill (${SKILL_NAMES.join('|')}|clear|off). No retrieval effect in schema v9.`,
    )
    .argument('<level>', `${SKILL_NAMES.join('|')}|${SKILL_MIN}-${SKILL_MAX}|clear|off`)
    .action((level) => {
      try {
        const n = parseSkillLevel(level);
        writeConfig({ skillLevel: n });
        if (n == null) {
          console.log(msgSkillCleared());
          return;
        }
        console.log(msgSkillSet(n));
      } catch (e) {
        console.error(errorLine(e.message));
        process.exitCode = 1;
      }
    });

  program
    .command('config')
    .description('Show or locate user config')
    .argument('<action>', 'show|path')
    .action((action) => {
      const a = String(action || '').toLowerCase();
      try {
        if (a === 'path') {
          console.log(configFilePath());
          return;
        }
        if (a === 'show') {
          const cfg = readConfig();
          console.log(JSON.stringify({ path: configFilePath(), ...cfg }, null, 2));
          return;
        }
        console.error(errorLine('Usage: git-grasp config show|path'));
        process.exitCode = 1;
      } catch (e) {
        console.error(errorLine(e.message));
        process.exitCode = 1;
      }
    });

  program
    .command('telemetry')
    .description('Opt in/out of optional cookieless CLI analytics (off by default)')
    .argument('<action>', 'on|off|status')
    .action(async (action) => {
      const a = String(action || '').toLowerCase();
      try {
        if (a === 'on') {
          if (isHardOff()) {
            console.error(
              errorLine(
                'Telemetry hard-off (DO_NOT_TRACK=1 or GIT_GRASP_TELEMETRY=0); cannot enable.',
              ),
            );
            process.exitCode = 1;
            return;
          }
          setTelemetryEnabled(true);
          const ev = buildCliOptInEvent();
          await sendUmamiEvent({ ...ev, verbose: false });
          console.log(msgTelemetryOn());
          return;
        }
        if (a === 'off') {
          setTelemetryEnabled(false);
          console.log(msgTelemetryOff());
          return;
        }
        if (a === 'status') {
          console.log(msgTelemetryStatusBlock(telemetryStatusDetail()));
          return;
        }
        console.error(errorLine('Usage: git-grasp telemetry on|off|status'));
        process.exitCode = 1;
      } catch (e) {
        console.error(errorLine(e.message));
        process.exitCode = 1;
      }
    });

  program
    .command('update-check')
    .description('Opt in/out of npm registry update notices (off by default)')
    .argument('<action>', 'on|off|status')
    .action(async (action) => {
      const a = String(action || '').toLowerCase();
      try {
        if (a === 'on') {
          setUpdateCheckEnabled(true);
          console.log(msgUpdateOn());
          return;
        }
        if (a === 'off') {
          setUpdateCheckEnabled(false);
          console.log(msgUpdateOff());
          return;
        }
        if (a === 'status') {
          const d = updateCheckStatusDetail();
          console.log(statusLine('Update check', d.label === 'on'));
          console.log(style.muted(`  config.updateCheck=${JSON.stringify(d.updateCheck)}`));
          console.log(style.muted(`  local=${d.local}`));
          console.log(style.muted(`  latest=${d.latest ?? '(not checked yet)'}`));
          console.log(style.muted(`  checkedAt=${d.checkedAt ?? 'never'}`));
          if (d.hardOff) console.log(style.muted('  hardOff=GIT_GRASP_UPDATE_CHECK=0'));
          const live = await checkForUpdate({ force: true });
          if (live.latest) {
            console.log(
              live.newer
                ? warnLine(`npm latest=${live.latest} (newer available)`)
                : okLine(`npm latest=${live.latest} (up to date)`),
            );
          } else {
            console.log(infoLine('npm latest=(unreachable)'));
          }
          return;
        }
        console.error(errorLine('Usage: git-grasp update-check on|off|status'));
        process.exitCode = 1;
      } catch (e) {
        console.error(errorLine(e.message));
        process.exitCode = 1;
      }
    });

  program
    .command('doctor')
    .description('Diagnose DB, model, sqlite-vec, and config')
    .action(async () => {
      const { doctor } = await import('./doctor.js');
      const d = doctor();
      for (const line of d.lines) console.log(line);
      process.exitCode = d.ok ? 0 : 2;
      if (d.ok) await maybeNotifyUpdate({ quiet: false });
    });

  program
    .command('init')
    .description('Verify install and warm the embedding model cache')
    .action(async () => {
      const { doctor } = await import('./doctor.js');
      const d = doctor();
      for (const line of d.lines) console.log(line);
      // Model missing alone is OK — init's job is to download/warm it.
      const f = d.failures || {};
      const hardFail = Boolean(
        f.runtime || f.vec || f.db || f.config || f.thresholds
        || (!d.failures && !d.ok),
      );
      if (hardFail) {
        process.exitCode = 2;
        return;
      }
      try {
        const mock = process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1';
        console.log(mock ? msgInitWarmMock() : msgInitWarm());
        const embedder = await getEmbedder({ forceMock: mock });
        await embedder.embed('git-grasp init warm');
        console.log(msgInitReady());
        console.log(formatVersionReport());
        process.exitCode = 0;
      } catch (e) {
        console.error(errorLine(e.message || e));
        process.exitCode = 1;
      }
    });

  program
    .command('completion')
    .description('Print shell completion script')
    .argument('<shell>', 'bash|zsh|fish|powershell')
    .action((shell) => {
      try {
        process.stdout.write(completionScript(shell));
      } catch (e) {
        console.error(errorLine(e.message));
        process.exitCode = 1;
      }
    });

  program
    .command('help', { isDefault: false })
    .description('Show help')
    .action(() => program.help());

  searchOptions(
    program.argument('[query...]', 'natural language query'),
  ).action(async (queryParts, opts) => {
    if (opts.version) {
      console.log(formatVersionReport());
      return;
    }
    const raw = queryParts || [];
    if (raw.length === 0) {
      const piped = await readStdinQuery();
      if (piped) {
        await runCliSearch(piped, opts, SEARCH_DEPS);
        return;
      }
      program.outputHelp();
      return;
    }
    const first = raw[0];
    if (ROOT_COMMANDS.has(first)) {
      return;
    }
    await runSearchCommand(program)(raw, opts);
  });

  return program;
}

/**
 * Parse argv; handle -V/--version before Commander so we always print identity.
 */
export async function runProgram(argv = process.argv) {
  const args = argv.slice(2);
  if (args.includes('-V') || args.includes('--version')) {
    console.log(formatVersionReport());
    return;
  }
  const program = buildProgram();
  await program.parseAsync(argv);
}

export { readConfig };
