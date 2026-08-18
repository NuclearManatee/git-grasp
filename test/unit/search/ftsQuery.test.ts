import { describe, expect, it } from 'bun:test';
import {
  buildFtsMatchQuery,
  commandFtsBody,
  tokenizeForFts,
  recipeFtsBody,
} from '../../../common/src/search/ftsQuery.ts';

describe('ftsQuery', () => {
  it('tokenizes and strips specials', () => {
    expect(tokenizeForFts('undo (last) commit*')).toEqual(['undo', 'last', 'commit']);
  });

  it('builds AND MATCH query', () => {
    expect(buildFtsMatchQuery('undo last commit')).toBe('"undo" AND "last" AND "commit"');
  });

  it('returns null for empty', () => {
    expect(buildFtsMatchQuery('   ')).toBeNull();
    expect(buildFtsMatchQuery('---')).toBeNull();
  });

  it('builds FTS body from commands+comments', () => {
    expect(
      commandFtsBody([
        { command: 'git reset --soft HEAD~1', comment: 'keep staged' },
        { command: 'git status' },
      ]),
    ).toContain('keep staged');
  });

  it('builds recipe FTS body with title and description', () => {
    expect(
      recipeFtsBody([{ command: 'git status' }], {
        title: 'Status',
        description: 'show tree',
        tags: ['inspect', ''],
        paraphrases: ['working tree', ''],
      }),
    ).toContain('working tree');
    expect(
      commandFtsBody([{ command: 'git status' }], ['how do I see status', '']),
    ).toContain('how do I see status');
  });
});
