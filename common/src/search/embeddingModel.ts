// @ts-nocheck
/**
 * Shared embedding model identity for CLI seed/search and browser playground.
 * Pin revision so Hub updates cannot silently change vectors vs the seeded DB.
 *
 * Current: BAAI bge-small-en-v1.5 via Transformers.js ONNX (`Xenova/…`).
 * Native 384-d — matches EMBEDDING_DIM; drop-in vs prior MiniLM width.
 * Changing id/revision requires a full re-embed of the catalog (staging + product).
 *
 * v1.5 is usable without a query instruction (slight retrieval trade-off).
 * Do not mix instruction-prefixed queries with unprefixed intent vectors unless
 * both sides of the index are rebuilt with a consistent scheme.
 */
export const EMBEDDING_MODEL_ID = 'Xenova/bge-small-en-v1.5';

/** Hugging Face Hub commit that must match seeded catalog embeddings. */
export const EMBEDDING_MODEL_REVISION = 'ea104dacec62c0de699686887e3f920caeb4f3e3';
