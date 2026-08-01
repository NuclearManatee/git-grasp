import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  routeChunksToCommands,
  assembleSemanticBlocks,
} from '../../../common/src/build/prepare.ts';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/prepare/route-vectors.json',
);

describe('prepare router frozen vector fixtures', () => {
  it('routes frozen vectors without calling OpenAI', () => {
    const fix = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const taxonomy = fix.taxonomy;
    const chunkVectors = fix.chunks.map((c) => c.vector);
    const { assignments, unrouted } = routeChunksToCommands(chunkVectors, taxonomy, {
      floor: 0.75,
      delta: 0.05,
      maxAnchors: 3,
      chunkTexts: fix.chunks.map((c) => c.content),
    });

    for (let i = 0; i < fix.chunks.length; i += 1) {
      const expectCmds = fix.chunks[i].expect_commands;
      if (!expectCmds.length) {
        expect(unrouted).toContain(i);
      } else {
        const a = assignments.find((x) => x.chunkIndex === i);
        expect(a).toBeTruthy();
        expect(a.commands).toEqual(expectCmds);
      }
    }

    const chunks = fix.chunks.map((c) => ({ origin: c.id, content: c.content }));
    const blocks = assembleSemanticBlocks(chunks, assignments);
    expect(blocks.some((b) => b.command === 'git status')).toBe(true);
  });
});
