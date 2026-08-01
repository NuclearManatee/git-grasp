import { describe, it, expect } from 'vitest';
import { chunkDocument } from '../../../packages/core/src/build/prepare.ts';

describe('prepare paragraph chunker', () => {
  it('binds code fences to preceding prose and path prefix', () => {
    const md = `## Branching

Create a branch.

\`\`\`
git switch -c topic
\`\`\`
`;
    const chunks = chunkDocument(md, 'progit', 'Pro Git');
    expect(chunks.length).toBeGreaterThan(0);
    const withFence = chunks.find((c) => c.content.includes('git switch'));
    expect(withFence).toBeTruthy();
    expect(withFence.content).toMatch(/^\[Pro Git > Branching\]/);
    expect(withFence.content).toContain('Create a branch');
    expect(withFence.content).toContain('git switch -c topic');
  });

  it('splits on blank lines into separate paragraphs', () => {
    const md = `## Status

First paragraph about status.

Second paragraph also about status.
`;
    const chunks = chunkDocument(md, 'doc', 'Doc');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.content.startsWith('[Doc > Status]'))).toBe(true);
  });

  it('binds tldr-style sole backtick command lines to preceding prose', () => {
    const md = `# git add

- Stage a file for a commit:

\`git add {{path/to/file}}\`

- Add all files:

\`git add .\`
`;
    const chunks = chunkDocument(md, 'tldr/git-add.md', 'git-add.md');
    const staged = chunks.find((c) => c.content.includes('Stage a file'));
    expect(staged).toBeTruthy();
    expect(staged.content).toContain('`git add {{path/to/file}}`');
    expect(staged.content).not.toContain('Add all files');
    const all = chunks.find((c) => c.content.includes('Add all files'));
    expect(all?.content).toContain('`git add .`');
  });
});
