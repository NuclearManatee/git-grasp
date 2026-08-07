#!/usr/bin/env bun
// @ts-nocheck
/** Bake the pinned embedding model into the environment (Docker image build). */
import { getEmbedder, embeddingModelId } from '@git-grasp/common';

console.log(`Warming ${embeddingModelId()}…`);
const embedder = await getEmbedder({
  onStatus: (m) => console.log(m),
});
const v = await embedder.embed('git status');
console.log(`OK dim=${v.length} mock=${embedder.mock}`);
