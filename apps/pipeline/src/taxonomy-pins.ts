// @ts-nocheck
/**
 * One-shot: LLM passes A–D → git_commands.roles.json + canonical_pins.json
 * Requires DEEPSEEK_API_KEY (or configured LLM provider).
 *
 * Flags:
 *   --reuse-roles   Skip Pass A; continue B–D from existing git_commands.roles.json
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTaxonomyPins } from '../../../common/src/build/taxonomyPins.ts';
import {
  gitCommandsRolesPath,
} from '../../../common/src/lib/paths.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reuse = process.argv.includes('--reuse-roles');

const result = await runTaxonomyPins({
  reuseRolesPath: reuse ? gitCommandsRolesPath() : null,
});

console.log(
  JSON.stringify(
    {
      cwd: root,
      roles: result.rolesPath,
      pins: result.pinsPath,
      stats: result.stats,
    },
    null,
    2,
  ),
);
