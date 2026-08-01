import { describe, it, expect } from 'vitest';
import { chunkDocument, routeChunksToCommands } from '../../../common/src/build/prepare.ts';
import { scrambleQuery, evaluateQuery } from '../../../common/src/build/evalGate.ts';
import { compareSimplicity, countFlags } from '../../../common/src/build/dedup.ts';

describe('prepare chunk + route', () => {
  it('binds code fences to headers', () => {
    const md = `## Branching\n\nCreate a branch.\n\n\`\`\`\ngit switch -c topic\n\`\`\`\n`;
    const chunks = chunkDocument(md, 'progit', 'Pro Git');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.content.includes('git switch'))).toBe(true);
    expect(chunks[0].content).toMatch(/^\[/);
  });

  it('routes similar vectors to taxonomy anchors', () => {
    const taxonomy = [
      { command: 'git status', vector: [1, 0, 0] },
      { command: 'git commit', vector: [0, 1, 0] },
    ];
    const { assignments, unrouted } = routeChunksToCommands(
      [
        [0.99, 0.01, 0],
        [0, 0, 1],
      ],
      taxonomy,
      { floor: 0.75 },
    );
    expect(assignments[0].commands).toContain('git status');
    expect(unrouted).toContain(1);
  });
});

describe('eval gate', () => {
  it('scramble is deterministic and keeps readable words', () => {
    const a = scrambleQuery('show working tree status', 42);
    const b = scrambleQuery('show working tree status', 42);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
    expect(a.split(/\s+/).length).toBeGreaterThanOrEqual(3);
  });

  it('Hit@display passes without judge', async () => {
    const r = await evaluateQuery(
      { query_text: 'undo', command_id: 7 },
      async () => [{ command_id: 7 }, { command_id: 1 }, { command_id: 2 }],
    );
    expect(r.pass).toBe(true);
    expect(r.via).toBe('hit@display');
  });

  it('miss + high utility judge passes', async () => {
    const r = await evaluateQuery(
      { query_text: 'undo', command_id: 7 },
      async () => [{ command_id: 1 }],
      {
        llmJsonObject: async () => ({ utility: 0.95, reason: 'helpful next step' }),
      },
    );
    expect(r.pass).toBe(true);
    expect(r.via).toBe('judge');
  });

  it('miss + low utility fails', async () => {
    const r = await evaluateQuery(
      { query_text: 'undo', command_id: 7 },
      async () => [{ command_id: 1 }],
      {
        llmJsonObject: async () => ({ utility: 0.5, reason: 'wrong' }),
      },
    );
    expect(r.pass).toBe(false);
  });
});

describe('dedup unit', () => {
  it('counts flags', () => {
    expect(countFlags({ commands: [{ command: 'git reset --soft HEAD~1' }] })).toBe(1);
    expect(
      compareSimplicity(
        { commands: [{ command: 'git status' }] },
        { commands: [{ command: 'git status' }, { command: 'git log' }] },
      ),
    ).toBeLessThan(0);
  });
});
