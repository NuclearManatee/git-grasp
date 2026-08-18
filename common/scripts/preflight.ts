#!/usr/bin/env bun
/**
 * Maintainer preflight: run the local CI gate, then print the next manual steps.
 */
import { runCi } from './ci.ts';

const NEXT_STEPS = `
Preflight (CI) passed.

Next (manual, before merging to main):
  bun run eval:regression   # real embeddings; same gate as eval-main / release

First GitHub publish (git-flow branches; skip stale feature/*):
  git push -u origin develop
  git push -u origin improve/catalog-ays-llm-band improve/catalog-recipes-v5 improve/catalog-ux-v2 improve/usage-confidence-eval
  git push -u origin legacy/v8
  # defer main until release-ready (triggers Release + Pages)

See docs/maintainer.md
`;

if (import.meta.main) {
  try {
    const code = runCi();
    if (code !== 0) process.exit(code);
    console.log(NEXT_STEPS.trimEnd());
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
