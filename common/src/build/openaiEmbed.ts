// @ts-nocheck
import OpenAI from 'openai';
import pLimit from 'p-limit';

const DEFAULT_MODEL = 'text-embedding-3-small';

/**
 * @param {{ apiKey?: string, model?: string, concurrency?: number }} [opts]
 */
export function createOpenAIEmbedder(opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY required for Step âˆ’1 embeddings');
  const client = new OpenAI({ apiKey });
  const model = opts.model || DEFAULT_MODEL;
  const limit = pLimit(opts.concurrency ?? 8);

  return {
    model,
    async embed(text) {
      const res = await client.embeddings.create({
        model,
        input: text,
      });
      return res.data[0].embedding;
    },
    async embedMany(texts, progressOpts = {}) {
      let done = 0;
      const total = texts.length;
      const every = progressOpts.every ?? 25;
      const onProgress = progressOpts.onProgress;
      return Promise.all(
        texts.map((t) =>
          limit(async () => {
            const vec = await this.embed(t);
            done += 1;
            if (
              onProgress &&
              (done === total || done % every === 0)
            ) {
              onProgress({ done, total });
            }
            return vec;
          }),
        ),
      );
    },
  };
}

/** Cosine similarity for number[] vectors. */
export function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
