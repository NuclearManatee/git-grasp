/**
 * Completeness checklist topics for catalog self-critique.
 */
export const TOPIC_CHECKLIST = [
  'create', 'status', 'diff', 'stage', 'commit', 'history', 'branch', 'merge',
  'rebase', 'remote', 'undo', 'clean', 'stash', 'tag', 'config', 'help',
  'debug', 'maintenance', 'submodule', 'worktree', 'sparse', 'files', 'search',
  'archive', 'bundle', 'notes', 'patch', 'advanced', 'security', 'gui',
];

/**
 * @param {Array<{ topic?: string, example?: string, command?: string }>} rows
 */
export function critiqueCoverage(rows) {
  const topics = new Set((rows || []).map((c) => c.topic));
  const missing = TOPIC_CHECKLIST.filter((t) => !topics.has(t));
  const count = (rows || []).length;
  return {
    complete: missing.length === 0 && count >= 200,
    missing,
    count,
  };
}
