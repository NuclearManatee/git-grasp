import { describe, it, expect } from 'vitest';
import {
  routeChunksToCommands,
  assembleSemanticBlocks,
  ROUTE_SIM_FLOOR,
  ROUTE_DELTA,
  ROUTE_MAX_ANCHORS,
} from '../../../packages/core/src/build/prepare.ts';

describe('prepare multi-anchor router (injected vectors)', () => {
  const taxonomy = [
    { command: 'git status', vector: [1, 0, 0] },
    { command: 'git commit', vector: [0, 1, 0] },
    { command: 'git rebase', vector: [0, 0, 1] },
  ];

  it('exports routing constants', () => {
    expect(ROUTE_SIM_FLOOR).toBe(0.75);
    expect(ROUTE_DELTA).toBe(0.05);
    expect(ROUTE_MAX_ANCHORS).toBe(3);
  });

  it('drops chunks below absolute floor', () => {
    const { assignments, unrouted } = routeChunksToCommands([[0.2, 0.2, 0.2]], taxonomy, {
      floor: 0.75,
    });
    expect(assignments).toHaveLength(0);
    expect(unrouted).toEqual([0]);
  });

  it('keeps anchors within Δ of best and caps at N', () => {
    // best=status ~1.0; commit within delta if we craft carefully
    const chunk = [0.95, 0.93, 0.1];
    const { assignments } = routeChunksToCommands([chunk], taxonomy, {
      floor: 0.5,
      delta: 0.05,
      maxAnchors: 3,
    });
    expect(assignments).toHaveLength(1);
    expect(assignments[0].commands[0]).toBe('git status');
    expect(assignments[0].commands.length).toBeLessThanOrEqual(3);
    // commit should be close if cosine of [0.95,0.93,0.1] vs commit [0,1,0]
    // cos(status)=0.95/norm, cos(commit)=0.93/norm — within 0.05 of each other relative to best
  });

  it('hard-caps at maxAnchors even when many are within Δ', () => {
    const tax = [
      { command: 'a', vector: [1, 0, 0, 0] },
      { command: 'b', vector: [0.99, 0.01, 0, 0] },
      { command: 'c', vector: [0.98, 0.02, 0, 0] },
      { command: 'd', vector: [0.97, 0.03, 0, 0] },
    ];
    const { assignments } = routeChunksToCommands([[1, 0, 0, 0]], tax, {
      floor: 0.5,
      delta: 0.1,
      maxAnchors: 3,
    });
    expect(assignments[0].commands).toHaveLength(3);
  });

  it('duplicates chunk into each matched semantic_block', () => {
    const chunks = [{ origin: 'tldr', content: 'status and commit' }];
    const { assignments } = routeChunksToCommands([[0.9, 0.88, 0]], taxonomy, {
      floor: 0.5,
      delta: 0.05,
    });
    const blocks = assembleSemanticBlocks(chunks, assignments);
    const status = blocks.find((b) => b.command === 'git status');
    const commit = blocks.find((b) => b.command === 'git commit');
    expect(status?.blocks[0].content).toBe('status and commit');
    expect(commit?.blocks[0].content).toBe('status and commit');
  });

  it('lexical mention lifts score to floor so bound examples route', () => {
    const taxonomyLex = [
      { command: 'git add', vector: [1, 0, 0] },
      { command: 'git status', vector: [0, 1, 0] },
    ];
    // Low cosine to add, but text mentions git add
    const { assignments, unrouted } = routeChunksToCommands([[0.2, 0.2, 0]], taxonomyLex, {
      floor: 0.75,
      delta: 0.05,
      chunkTexts: ['- Stage a file:\n`git add path`'],
    });
    expect(unrouted).toHaveLength(0);
    expect(assignments[0].commands).toContain('git add');
  });
});
