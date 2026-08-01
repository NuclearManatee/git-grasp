// @ts-nocheck
import { validateInSandboxAndDestroy } from './sandbox.js';
import { generateRecipeFromSemanticBlock } from './generate.js';
import { VALIDATION_MAX_REGEN } from '../db/constants.js';
import { assertRecipeFlagsAllowed } from './recipeFlags.js';

/**
 * Generate + validate with reflective regen.
 */
export async function generateAndValidate(group, opts = {}) {
  const maxRegen = opts.maxRegen ?? VALIDATION_MAX_REGEN;
  let feedback = '';
  let last = null;
  for (let attempt = 0; attempt <= maxRegen; attempt += 1) {
    const generated = opts.generate
      ? await opts.generate(group, { feedback })
      : await generateRecipeFromSemanticBlock(group, {
          feedback,
          llmJsonObject: opts.llmJsonObject,
        });
    last = generated;

    const flagGate = assertRecipeFlagsAllowed(generated, {
      fetchHelp: opts.fetchHelp,
    });
    if (!flagGate.ok) {
      feedback = `reason=${flagGate.reason}\nstdout=\nstderr=\nfailed=flag_allowlist`;
      continue;
    }

    const result = opts.validate
      ? await opts.validate(generated)
      : validateInSandboxAndDestroy({
          ...generated,
          workerId: opts.workerId,
          jobId: `${opts.jobId || 'g'}-${attempt}`,
        });
    if (result.ok) {
      return {
        ok: true,
        ...generated,
        initial_state_physical_hash: result.initial_state_physical_hash,
        final_state_physical_hash: result.final_state_physical_hash,
        attempts: attempt + 1,
      };
    }
    feedback = `reason=${result.reason}\nstdout=${result.stdout || ''}\nstderr=${result.stderr || ''}\nfailed=${result.failedCommand || ''}`;
  }
  return { ok: false, last, reason: 'regen_exhausted' };
}
