/**
 * Completeness checklist topics for catalog self-critique.
 */
export const TOPIC_CHECKLIST = [
  'create', 'status', 'diff', 'stage', 'commit', 'history', 'branch', 'merge',
  'rebase', 'remote', 'undo', 'clean', 'stash', 'tag', 'config', 'help',
  'debug', 'maintenance', 'submodule', 'worktree', 'sparse', 'files', 'search',
  'archive', 'bundle', 'notes', 'patch', 'advanced', 'security', 'gui',
];

export function critiqueCoverage(commands) {
  const topics = new Set(commands.map((c) => c.topic));
  const missing = TOPIC_CHECKLIST.filter((t) => !topics.has(t));
  return {
    complete: missing.length === 0 && commands.length >= 200,
    missing,
    count: commands.length,
  };
}
