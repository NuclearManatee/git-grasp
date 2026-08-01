// @ts-nocheck
/**
 * One-shot: scrape `git help -a` → common/taxonomy/git_commands.json
 * Not re-run by build:prepare.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseGitHelpAll,
  buildGitCommandsTaxonomy,
} from '../../../common/src/build/taxonomyScrape.ts';
import { spawnGit } from '../../../common/src/build/gitExec.ts';
import { gitCommandsTaxonomyPath } from '../../../common/src/lib/paths.ts';

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

const taxonomy = buildGitCommandsTaxonomy({
  sections: parsed.sections,
  scraped_at: new Date().toISOString(),
});

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(taxonomy, null, 2)}\n`);
console.log(
  `Wrote ${taxonomy.commands.length} commands in ${taxonomy.sections.length} sections → ${outPath}`,
);
