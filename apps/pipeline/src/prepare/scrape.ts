// @ts-nocheck
/**
 * One-shot: scrape `git help -a` → common/taxonomy/git_commands.json
 * Probes each verb for local availability (git subcommand vs standalone vs missing).
 * Host-local probe paths are stripped from the committed artifact; full probe
 * report is written under local/prepare/.
 * Not re-run by build:prepare.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseGitHelpAll,
  buildGitCommandsTaxonomy,
  stripProbePathsForCommit,
} from '../../../../common/src/build/taxonomyScrape.ts';
import { spawnGit } from '../../../../common/src/build/gitExec.ts';
import { gitCommandsTaxonomyPath, localDir } from '../../../../common/src/lib/paths.ts';

const outPath = gitCommandsTaxonomyPath();

const r = spawnGit(['help', '-a'], {
  maxBuffer: 4 * 1024 * 1024,
});
if (r.error || r.status !== 0) {
  console.error(r.stderr || r.error || `git help -a exited ${r.status}`);
  process.exit(1);
}

const parsed = parseGitHelpAll(r.stdout || '');
if (parsed.sections.length !== 3) {
  console.error(
    `Expected 3 taxonomy sections, got ${parsed.sections.length}: ${parsed.sections.map((s) => s.name).join(', ')}`,
  );
  process.exit(1);
}
if (parsed.commands.length < 20) {
  console.error(`Suspiciously few commands: ${parsed.commands.length}`);
  process.exit(1);
}

console.log(`Probing ${parsed.commands.length} commands for local availability…`);
const taxonomyFull = buildGitCommandsTaxonomy({
  sections: parsed.sections,
  scraped_at: new Date().toISOString(),
  probe: true,
  keepRawDetail: true,
});

const probeDir = path.join(localDir(), 'prepare');
mkdirSync(probeDir, { recursive: true });
writeFileSync(
  path.join(probeDir, 'scrape-probe.json'),
  `${JSON.stringify(taxonomyFull, null, 2)}\n`,
);

const taxonomy = stripProbePathsForCommit(taxonomyFull);

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(taxonomy, null, 2)}\n`);

const a = taxonomy.availability || {};
console.log(
  `Wrote ${taxonomy.commands.length} commands in ${taxonomy.sections.length} sections → ${outPath}`,
);
console.log(
  `Availability: available=${a.available} unavailable=${a.unavailable} standalone=${a.standalone} total=${a.total}`,
);
console.log(`Full probe report → ${path.join(probeDir, 'scrape-probe.json')}`);
const missing = taxonomy.commands.filter((c) => !c.available).map((c) => c.name);
if (missing.length) {
  console.log(`Unavailable here: ${missing.join(', ')}`);
}
const solo = taxonomy.commands.filter((c) => c.runner === 'standalone');
if (solo.length) {
  console.log(`Standalone runners: ${solo.map((c) => `${c.name}→${c.command}`).join(', ')}`);
}
