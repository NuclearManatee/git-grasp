import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_DIM,
  INTENT_REEXPAND_CONCURRENCY,
} from '../../../common/src/db/constants.ts';
import {
  openDb,
  insertCommand,
  insertIntentWithEmbedding,
  countIntents,
} from '../../../common/src/db/schema.ts';
import { reexpandIntentsForStaging } from '../../../common/src/build/evalImprove/reexpandIntents.ts';

function unitVec(seed: number) {
  const out = new Float32Array(EMBEDDING_DIM);
  out[seed % EMBEDDING_DIM] = 1;
  return out;
}

function rawDb(db: ReturnType<typeof openDb>) {
  return (db as { _db?: unknown })._db ?? db;
}

function intentTexts(db: ReturnType<typeof openDb>): string[] {
  return rawDb(db)
    .prepare('SELECT intent_text FROM intents ORDER BY rowid')
    .all()
    .map((r: { intent_text: string }) => r.intent_text);
}

function seedCommands(db: ReturnType<typeof openDb>, n: number) {
  const ids: number[] = [];
  for (let i = 0; i < n; i += 1) {
    ids.push(
      insertCommand(db, {
        initial_state: 'git init\n',
        command_recipe: {
          commands: [{ command: `git status` }],
        },
        initial_state_physical_hash: `i${i}`,
        final_state_physical_hash: `f${i}`,
        risk: 0.1,
        mutation_kind: null,
        title: `cmd ${i}`,
      }),
    );
  }
  return ids;
}

describe('reexpandIntentsForStaging parallel', () => {
  it('exports INTENT_REEXPAND_CONCURRENCY default 24', () => {
    expect(INTENT_REEXPAND_CONCURRENCY).toBe(24);
  });

  it('runs expand phase with bounded concurrency (max in-flight ≈ concurrency)', async () => {
    const db = openDb(':memory:');
    seedCommands(db, 8);
    let inFlight = 0;
    let maxInFlight = 0;
    const seen = new Set<number>();

    const out = await reexpandIntentsForStaging(
      db,
      { embed: async (t) => unitVec(String(t).length) },
      {
        concurrency: 3,
        expandIntents: async (_recipe, { commandId }) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          seen.add(commandId);
          await new Promise((r) => setTimeout(r, 40));
          inFlight -= 1;
          return [
            {
              skill_level: 'beginner',
              intent_category: 'goal',
              intent_text: `intent for ${commandId}`,
            },
          ];
        },
      },
    );

    expect(out.commands).toBe(8);
    expect(out.intents).toBe(8);
    expect(out.failed).toBe(0);
    expect(out.concurrency).toBe(3);
    expect(seen.size).toBe(8);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(countIntents(db)).toBe(8);
    db.close();
  });

  it('skips failed expands without wiping prior intents for that command', async () => {
    const db = openDb(':memory:');
    const [idOk, idBad] = seedCommands(db, 2);
    insertIntentWithEmbedding(db, {
      command_id: idBad,
      skill_level: 'beginner',
      intent_category: 'goal',
      intent_text: 'keep me',
      embedding: unitVec(1),
    });

    const out = await reexpandIntentsForStaging(
      db,
      { embed: async (t) => unitVec(String(t).length + 3) },
      {
        concurrency: 2,
        expandIntents: async (_recipe, { commandId }) => {
          if (commandId === idBad) throw new Error('boom');
          return [
            {
              skill_level: 'beginner',
              intent_category: 'goal',
              intent_text: `fresh ${commandId}`,
            },
          ];
        },
      },
    );

    expect(out.failed).toBe(1);
    expect(out.intents).toBe(1);
    const texts = intentTexts(db);
    expect(texts).toContain('keep me');
    expect(texts).toContain(`fresh ${idOk}`);
    db.close();
  });

  it('finishes all expands before any write (two-phase)', async () => {
    const db = openDb(':memory:');
    seedCommands(db, 4);
    const phases: string[] = [];
    let writesStarted = false;
    let expandSawWrite = false;

    await reexpandIntentsForStaging(
      db,
      {
        embed: async (t) => {
          writesStarted = true;
          return unitVec(String(t).length);
        },
      },
      {
        concurrency: 4,
        expandIntents: async () => {
          if (writesStarted) expandSawWrite = true;
          await new Promise((r) => setTimeout(r, 20));
          return [
            {
              skill_level: 'beginner',
              intent_category: 'goal',
              intent_text: 'x',
            },
          ];
        },
        onProgress: (p) => {
          phases.push(p.phase);
        },
      },
    );

    expect(expandSawWrite).toBe(false);
    expect(phases.filter((p) => p === 'expand').length).toBeGreaterThanOrEqual(4);
    expect(phases.filter((p) => p === 'write').length).toBeGreaterThanOrEqual(4);
    const firstWrite = phases.indexOf('write');
    const lastExpand = phases.lastIndexOf('expand');
    expect(lastExpand).toBeLessThan(firstWrite);
    db.close();
  });
});
