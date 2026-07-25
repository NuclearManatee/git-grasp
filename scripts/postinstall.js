#!/usr/bin/env node
/**
 * Postinstall: ensure embedding model is available (or skip).
 * With GIT_HELP_SKIP_POSTINSTALL=1, no-op.
 * Default: rely on @huggingface/transformers lazy download on first real embed;
 * optionally warm the cache here.
 */
if (process.env.GIT_HELP_SKIP_POSTINSTALL === '1') {
  console.log('git-help: postinstall skipped (GIT_HELP_SKIP_POSTINSTALL=1)');
  process.exit(0);
}

if (process.env.GIT_HELP_MOCK_EMBEDDINGS === '1') {
  console.log('git-help: mock embeddings — postinstall no model fetch');
  process.exit(0);
}

console.log('git-help: model will download on first non-mock embed (Hugging Face / Xenova)');
console.log('git-help: set GIT_HELP_SKIP_POSTINSTALL=1 to silence this');
process.exit(0);
