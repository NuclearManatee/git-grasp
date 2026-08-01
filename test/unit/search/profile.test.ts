import { describe, expect, it } from 'vitest';
import {
  blendWeightsForSkill,
  heuristicSkillLevel,
  profileQuery,
} from '../../../packages/core/src/search/profile.ts';
import { parseGitVerbsMeta, serializeGitVerbsMeta } from '../../../packages/core/src/search/gitVerbs.ts';

const VERBS = ['status', 'commit', 'reset', 'rebase', 'stash', 'checkout', 'merge', 'push', 'pull'];

describe('blendWeightsForSkill', () => {
  it('maps novice bucket to α=0.70', () => {
    expect(blendWeightsForSkill('nontechnical')).toEqual({ alpha: 0.7, beta: 0.3, blendBucket: 'novice' });
    expect(blendWeightsForSkill('beginner')).toEqual({ alpha: 0.7, beta: 0.3, blendBucket: 'novice' });
  });

  it('maps expert bucket to α=0.30', () => {
    expect(blendWeightsForSkill('intermediate')).toEqual({ alpha: 0.3, beta: 0.7, blendBucket: 'expert' });
    expect(blendWeightsForSkill('expert')).toEqual({ alpha: 0.3, beta: 0.7, blendBucket: 'expert' });
  });
});

describe('heuristicSkillLevel', () => {
  it('flags → expert', () => {
    expect(heuristicSkillLevel('reset --hard HEAD~1', VERBS)).toBe('expert');
    expect(heuristicSkillLevel('git commit -m msg', VERBS)).toBe('expert');
  });

  it('allowlisted verb without flags → intermediate', () => {
    expect(heuristicSkillLevel('rebase onto main', VERBS)).toBe('intermediate');
    expect(heuristicSkillLevel('how to stash', VERBS)).toBe('intermediate');
  });

  it('soft git words without allowlisted verb → beginner', () => {
    expect(heuristicSkillLevel('undo my last commit', ['status'])).toBe('beginner');
    expect(heuristicSkillLevel('how do I branch', ['status'])).toBe('beginner');
  });

  it('pure NL → nontechnical', () => {
    expect(heuristicSkillLevel('how do I go back', [])).toBe('nontechnical');
  });
});

describe('profileQuery', () => {
  it('config preferred skill wins over heuristic', () => {
    const p = profileQuery('reset --hard', {
      preferredSkill: 'beginner',
      verbs: VERBS,
    });
    expect(p.preferredSkill).toBe('beginner');
    expect(p.alpha).toBe(0.7);
    expect(p.beta).toBe(0.3);
  });

  it('uses heuristic when preferred unset', () => {
    const p = profileQuery('git rebase', { preferredSkill: null, verbs: VERBS });
    expect(p.preferredSkill).toBe('intermediate');
    expect(p.alpha).toBe(0.3);
  });
});

describe('gitVerbs meta', () => {
  it('round-trips JSON array', () => {
    const s = serializeGitVerbsMeta(['status', 'commit']);
    expect(parseGitVerbsMeta(s)).toEqual(['status', 'commit']);
  });

  it('returns empty on bad meta', () => {
    expect(parseGitVerbsMeta(null)).toEqual([]);
    expect(parseGitVerbsMeta('not-json')).toEqual([]);
  });
});
