#!/usr/bin/env bun
/** Bake Xenova MiniLM into the environment (Docker image build). */
import { getEmbedder, embeddingModelId } from '@git-help/core';

console.log(`Warming ${embeddingModelId()}…`);
const embedder = await getEmbedder({
  onStatus: (m) => console.log(m),
});
const v = await embedder.embed('git status');
console.log(`OK dim=${v.length} mock=${embedder.mock}`);
