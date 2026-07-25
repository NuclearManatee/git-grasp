import { describe, it, expect, beforeEach } from 'vitest';
import { EMBEDDING_DIM } from '../../packages/core/src/db/constants.js';
import {
  encodeWebPack,
  decodeWebPack,
  knnWebPack,
  sha256Hex,
} from '../../packages/core/src/search/webPack.js';
import {
  openWebPack,
  searchBrowser,
  resetWebPackForTests,
} from '../../packages/core/src/search/browser.js';
import {
  mockEmbedBrowser,
  resetBrowserEmbedderForTests,
} from '../../packages/core/src/search/embed.browser.js';

function row(id, text, skill = 2) {
  return {
    id,
    command: 'git reset',
    example: text.includes('hard') ? 'git reset --hard HEAD~1' : 'git reset --soft HEAD~1',
    usage: `${text.includes('hard') ? 'git reset --hard HEAD~1' : 'git reset --soft HEAD~1'}\nblurb`,
    intent_family: 'undo',
    simplicity_rank: 1,
    skill_level: skill,
    intent_description: text,
    explanation: 'test',
    schema_version: 4,
    embedding: mockEmbedBrowser(text),
  };
}

const thresholds = {
  topK: 3,
  maxSecondGap: 0.04,
  confidenceYellowScore: 0.45,
  confidenceRedScore: 0.3,
  requireSkillConsistency: true,
  normalizeQuery: true,
  simplicityWindow: 0.08,
  advancedWindow: 0.12,
  specificityWindow: 0.12,
  specificityPromoteMargin: 0.05,
};

describe('webPack', () => {
  it('round-trips encode/decode', async () => {
    const rows = [
      row('a', 'undo last commit keep changes staged'),
      row('b', 'throw away last commit permanently'),
    ];
    const bytes = encodeWebPack({ dim: EMBEDDING_DIM, thresholds, rows });
    const pack = decodeWebPack(bytes);
    expect(pack.dim).toBe(EMBEDDING_DIM);
    expect(pack.rows).toHaveLength(2);
    expect(pack.rows[0].id).toBe('a');
    expect(pack.rows[0].embedding).toHaveLength(EMBEDDING_DIM);
    expect(pack.thresholds.topK).toBe(3);
    const hash = await sha256Hex(bytes);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('knn returns nearest intent', () => {
    const rows = [
      row('soft', 'undo last commit keep changes staged'),
      row('hard', 'throw away last commit permanently'),
    ];
    const bytes = encodeWebPack({ dim: EMBEDDING_DIM, thresholds, rows });
    const pack = decodeWebPack(bytes);
    const q = mockEmbedBrowser('undo last commit keep changes staged');
    const hits = knnWebPack(pack, q, 2);
    expect(hits[0].id).toBe('soft');
    expect(hits[0]._forcedScore).toBeGreaterThan(hits[1]._forcedScore);
  });
});

describe('searchBrowser', () => {
  beforeEach(() => {
    resetWebPackForTests();
    resetBrowserEmbedderForTests();
  });

  it('searches with mock embeddings', async () => {
    const rows = [
      row('soft', 'undo last commit keep changes staged'),
      row('hard', 'throw away last commit permanently'),
    ];
    const bytes = encodeWebPack({ dim: EMBEDDING_DIM, thresholds, rows });
    await openWebPack(bytes);
    const result = await searchBrowser('undo last commit keep changes staged', {
      forceMockEmbeddings: true,
    });
    expect(result.query).toBeTruthy();
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].id).toBe('soft');
    expect(result.embedderMock).toBe(true);
  });

  it('rejects integrity mismatch', async () => {
    const rows = [row('a', 'create a branch')];
    const bytes = encodeWebPack({ dim: EMBEDDING_DIM, thresholds, rows });
    await expect(
      openWebPack(bytes, { expectedSha256: '0'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'INTEGRITY' });
  });
});
