import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  search,
  formatSearchResult,
  primaryCommand,
  writeConfig,
  readConfig,
  parseSkillLevel,
  skillName,
  SKILL_NAMES,
  SKILL_MIN,
  SKILL_MAX,
} from '@git-help/core/cli';

async function maybeCopy(text) {
  const clipboardy = await import('clipboardy');
  await clipboardy.default.write(text);
}

function runSearchCommand(program) {
  return async (queryParts, opts) => {
    const query = (queryParts || []).join(' ').trim();
    if (!query) {
      program.help();
      return;
    }
    const useSpinner = Boolean(process.stderr.isTTY) && process.env.GIT_HELP_BENCH !== '1';
    const spinner = useSpinner ? ora('Searching…').start() : null;
    try {
      const result = await search(query, {
        forceMockEmbeddings: process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
        onEmbedStatus: (msg) => {
          if (spinner) spinner.text = msg;
          else if (process.stderr.isTTY) console.error(msg);
        },
      });
      spinner?.stop();
      console.log(formatSearchResult(result, { verbose: Boolean(opts.verbose) }));
      if (process.env.GIT_HELP_BENCH === '1' && result._bench) {
        const { total, phases } = result._bench;
        const parts = Object.entries(phases)
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, v]) => `${k}=${v.toFixed(1)}ms`)
          .join(' ');
        console.error(chalk.dim(`[bench] total=${total.toFixed(1)}ms ${parts}`));
      }
      if (opts.copy) {
        const cmd = primaryCommand(result);
        if (cmd) {
          try {
            await maybeCopy(cmd);
            console.error(chalk.dim('Copied example to clipboard'));
          } catch {
            console.error(chalk.yellow('Clipboard unavailable; example printed above'));
          }
        }
      }
    } catch (err) {
      spinner?.stop();
      const code = err.code;
      console.error(chalk.red(err.message));
      if (code === 'INTEGRITY') process.exitCode = 2;
      else if (code === 'CONFIG') process.exitCode = 3;
      else if (code === 'FILTER_EMPTY') process.exitCode = 4;
      else process.exitCode = 1;
    }
  };
}

export function buildProgram() {
  const program = new Command();
  program
    .name('git-help')
    .description('Semantic search for Git commands')
    .version('0.1.0');

  program
    .command('search')
    .description('Search for a Git command')
    .argument('[query...]', 'natural language query')
    .option('-v, --verbose', 'show explanation, skill label, score, advanced alternate')
    .option('-c, --copy', 'copy winning example to clipboard')
    .action(runSearchCommand(program));

  program
    .command('set-level')
    .description(`Restrict search to at most this skill (${SKILL_NAMES.join('|')}), or clear/off`)
    .argument('<level>', `${SKILL_NAMES.join('|')}|${SKILL_MIN}-${SKILL_MAX}|clear|off`)
    .action((level) => {
      try {
        const n = parseSkillLevel(level);
        writeConfig({ skillLevel: n });
        if (n == null) {
          console.log('Skill filter cleared');
          return;
        }
        console.log(`Skill filter set to at most ${skillName(n)} (${n})`);
      } catch (e) {
        console.error(chalk.red(e.message));
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
    });

  program
    .command('help', { isDefault: false })
    .description('Show help')
    .action(() => program.help());

  program
    .argument('[query...]', 'natural language query')
    .option('-v, --verbose', 'show explanation, skill label, score, advanced alternate')
    .option('-c, --copy', 'copy winning example to clipboard')
    .action(async (queryParts, opts) => {
      const raw = queryParts || [];
      if (raw.length === 0) {
        program.outputHelp();
        return;
      }
      const first = raw[0];
      if (['search', 'set-level', 'doctor', 'help'].includes(first)) {
        return;
      }
      await runSearchCommand(program)(raw, opts);
    });

  return program;
}

export { readConfig };
