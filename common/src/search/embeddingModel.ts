// @ts-nocheck
/**
 * Shared embedding model identity for CLI seed/search and browser playground.
 * Pin revision so Hub updates cannot silently change vectors vs the seeded DB.
 */
export const EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/** Hugging Face Hub commit that must match seeded catalog embeddings. */
export const EMBEDDING_MODEL_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
