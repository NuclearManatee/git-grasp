import { skillPromptList } from '../lib/skills.js';

export const DEFAULT_GLOSSARY = {
  branch: ['main', 'develop', 'feature/login'],
  file: ['app.js', 'README.md', 'src/index.ts'],
  url: ['https://github.com/example/repo.git'],
  message: ['fix typo', 'Add login form'],
  commit: ['HEAD', 'HEAD~1', 'abc1234'],
  name: ['feature', 'v1.0.0', 'alice'],
  path: ['../hotfix', 'worktrees/feature'],
  pattern: ['TODO', 'FIXME'],
  email: ['dev@example.com'],
  other: ['upstream', 'origin'],
};

const GLOSSARY_SYSTEM = `You are building a placeholder glossary for a git-help catalog.
Return JSON only:
{
  "branch": ["main", "develop", "feature/login"],
  "file": ["app.js", "README.md"],
  "url": ["https://github.com/example/repo.git"],
  "message": ["Fix typo"],
  "commit": ["HEAD", "HEAD~1", "abc1234"],
  "name": ["feature", "v1.0.0"],
  "path": ["../hotfix"],
  "pattern": ["TODO"],
  "email": ["dev@example.com"],
  "other": ["origin", "upstream"]
}
Rules:
- Every value must be a concrete token a developer could paste into a shell (no <placeholders>).
- Prefer short, realistic git/dev names.
- Include at least 2 values per key when sensible.
- Skill context (for tone only): ${skillPromptList()}.`;

/**
 * Merge glossary objects (incoming arrays append unique values).
 */
export function mergeGlossary(base = {}, incoming = {}) {
  const out = { ...DEFAULT_GLOSSARY };
  for (const [k, v] of Object.entries(base || {})) {
    out[k] = uniqStrings([...(out[k] || []), ...(Array.isArray(v) ? v : [v])]);
  }
  for (const [k, v] of Object.entries(incoming || {})) {
    out[k] = uniqStrings([...(out[k] || []), ...(Array.isArray(v) ? v : [v])]);
  }
  return out;
}

function uniqStrings(arr) {
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
}

/**
 * Replace <placeholders> using glossary (deterministic first pick).
 * @param {string} text
 * @param {Record<string, string[]>} glossary
 */
export function materializePlaceholders(text, glossary = DEFAULT_GLOSSARY) {
  return String(text).replace(/<([a-zA-Z0-9_-]+)>/g, (_, key) => {
    const k = String(key).toLowerCase();
    const list = glossary[k] || glossary.other || ['value'];
    return list[0] || 'value';
  });
}

/**
 * LLM glossary generation (optional — falls back to DEFAULT_GLOSSARY).
 */
export async function generateGlossary({ llmJson, schedule }) {
  const jsonFn = llmJson;
  if (!jsonFn) return { ...DEFAULT_GLOSSARY };
  const messages = [
    { role: 'system', content: GLOSSARY_SYSTEM },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Produce a concrete token glossary for git command examples',
        seed: DEFAULT_GLOSSARY,
      }),
    },
  ];
  const out = await schedule(() => jsonFn({ messages }));
  return mergeGlossary(DEFAULT_GLOSSARY, out);
}

export { GLOSSARY_SYSTEM };
