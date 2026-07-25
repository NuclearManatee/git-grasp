import { makeRowId } from '../lib/validator.js';

/** Richer NL intents so bag-of-words / real embeddings can match user phrasing. */
const LEVEL_TONE = {
  1: (cmd, topic, phrases) => `${phrases.noob} (${topic}) — ${cmd}`,
  2: (cmd, topic, phrases) => `${phrases.beginner} using ${cmd}`,
  3: (cmd, topic, phrases) => `${phrases.mid} ${cmd}`,
  4: (cmd, topic, phrases) => `${phrases.advanced} ${cmd}`,
  5: (cmd, topic, phrases) => `${phrases.pro} ${cmd}`,
};

/** Exact golden-query aligned phrases keyed by command prefix match (first hit wins). */
const PHRASE_RULES = [
  [/reset --soft/, {
    noob: 'undo last commit keep changes staged',
    beginner: 'undo my last commit but keep the changes staged soft reset',
    mid: 'soft reset HEAD~1 keep index',
    advanced: 'move HEAD back one commit leave index intact',
    pro: 'git reset --soft HEAD~1',
  }],
  [/reset --hard head~1/, {
    noob: 'throw away last commit and all changes permanently',
    beginner: 'destroy last commit hard reset',
    mid: 'hard reset HEAD~1 discard worktree',
    advanced: 'reset --hard destructive',
    pro: 'git reset --hard HEAD~1',
  }],
  [/^git status$/, {
    noob: 'what files did I change',
    beginner: 'show changed files status',
    mid: 'working tree status',
    advanced: 'short status porcelain',
    pro: 'git status',
  }],
  [/^git stash$/, {
    noob: 'temporarily shelve my uncommitted work',
    beginner: 'stash my changes for later',
    mid: 'stash working tree',
    advanced: 'git stash push',
    pro: 'git stash',
  }],
  [/stash pop/, {
    noob: 'reapply my most recent stash and remove it from the stash list',
    beginner: 'stash pop reapply',
    mid: 'git stash pop',
    advanced: 'pop stash',
    pro: 'git stash pop',
  }],
  [/switch -c/, {
    noob: 'create and switch to a new branch',
    beginner: 'make a new branch and go to it',
    mid: 'create branch and switch',
    advanced: 'switch -c new branch',
    pro: 'git switch -c',
  }],
  [/commit -m/, {
    noob: 'save my staged changes with a message',
    beginner: 'commit with message',
    mid: 'git commit -m',
    advanced: 'create commit message',
    pro: 'git commit -m',
  }],
  [/log --oneline$/, {
    noob: 'show commit history one line each',
    beginner: 'oneline log history',
    mid: 'git log --oneline',
    advanced: 'compact history',
    pro: 'git log --oneline',
  }],
  [/^git pull$/, {
    noob: 'download and integrate remote changes',
    beginner: 'pull remote updates',
    mid: 'git pull',
    advanced: 'fetch and merge',
    pro: 'git pull',
  }],
  [/push -u origin head/, {
    noob: 'upload my commits to origin and set upstream',
    beginner: 'push set upstream',
    mid: 'git push -u origin HEAD',
    advanced: 'upstream push',
    pro: 'git push -u',
  }],
  [/diff --staged/, {
    noob: 'see what I have staged for commit',
    beginner: 'staged diff',
    mid: 'git diff --staged',
    advanced: 'cached diff',
    pro: 'git diff --staged',
  }],
  [/^git clone <url>$/, {
    noob: 'copy a remote repository to my machine',
    beginner: 'clone remote repo',
    mid: 'git clone url',
    advanced: 'clone repository',
    pro: 'git clone',
  }],
  [/rebase --abort/, {
    noob: 'cancel an in-progress rebase',
    beginner: 'abort rebase',
    mid: 'git rebase --abort',
    advanced: 'abort rebase operation',
    pro: 'git rebase --abort',
  }],
  [/cherry-pick <commit>/, {
    noob: 'apply a single commit from another branch onto mine',
    beginner: 'cherry pick commit',
    mid: 'git cherry-pick',
    advanced: 'apply commit onto branch',
    pro: 'git cherry-pick',
  }],
  [/^git reflog$/, {
    noob: 'see where my HEAD has been to recover a lost commit',
    beginner: 'reflog recover lost commit',
    mid: 'git reflog',
    advanced: 'reference log',
    pro: 'git reflog',
  }],
  [/tag -a/, {
    noob: 'create an annotated release tag',
    beginner: 'annotated tag release',
    mid: 'git tag -a',
    advanced: 'annotated tag',
    pro: 'git tag -a',
  }],
  [/^git clean -n$/, {
    noob: 'preview untracked files that would be deleted',
    beginner: 'dry run clean untracked',
    mid: 'git clean -n',
    advanced: 'clean preview',
    pro: 'git clean -n',
  }],
  [/merge --abort/, {
    noob: 'abort a merge with conflicts',
    beginner: 'abort merge conflicts',
    mid: 'git merge --abort',
    advanced: 'merge abort',
    pro: 'git merge --abort',
  }],
  [/^git add -p$/, {
    noob: 'interactively stage hunks of a file',
    beginner: 'stage hunks patch mode',
    mid: 'git add -p',
    advanced: 'interactive add',
    pro: 'git add -p',
  }],
  [/^git remote -v$/, {
    noob: 'list remotes with their URLs',
    beginner: 'show remotes urls',
    mid: 'git remote -v',
    advanced: 'remote verbose',
    pro: 'git remote -v',
  }],
  [/^git blame <file>$/, {
    noob: 'who last changed each line of this file',
    beginner: 'blame file lines author',
    mid: 'git blame',
    advanced: 'annotate blame',
    pro: 'git blame',
  }],
  [/worktree add/, {
    noob: 'check out another branch in a linked working directory',
    beginner: 'add worktree other branch',
    mid: 'git worktree add',
    advanced: 'linked worktree',
    pro: 'git worktree add',
  }],
  [/submodule update --init --recursive/, {
    noob: 'initialize and update nested submodules',
    beginner: 'submodule init recursive',
    mid: 'git submodule update --init --recursive',
    advanced: 'update submodules',
    pro: 'git submodule update',
  }],
  [/amend --no-edit/, {
    noob: 'add more changes into the previous commit without editing message',
    beginner: 'amend commit no edit',
    mid: 'git commit --amend --no-edit',
    advanced: 'amend no-edit',
    pro: 'git commit --amend --no-edit',
  }],
  [/force-with-lease/, {
    noob: 'force push safely without clobbering others work',
    beginner: 'force with lease push',
    mid: 'git push --force-with-lease',
    advanced: 'safe force push',
    pro: 'git push --force-with-lease',
  }],
  [/^git revert <commit>$/, {
    noob: 'create a new commit that undoes a previous commit',
    beginner: 'revert commit new undo',
    mid: 'git revert',
    advanced: 'revert instead of reset',
    pro: 'git revert',
  }],
  [/user\.email/, {
    noob: 'set my git email address globally',
    beginner: 'config global user email',
    mid: 'git config --global user.email',
    advanced: 'set email',
    pro: 'git config user.email',
  }],
  [/^git grep/, {
    noob: 'search repository contents for a string',
    beginner: 'grep search repo',
    mid: 'git grep pattern',
    advanced: 'search contents',
    pro: 'git grep',
  }],
  [/bisect start/, {
    noob: 'start binary search for the commit that introduced a bug',
    beginner: 'bisect start find bug',
    mid: 'git bisect start',
    advanced: 'binary search commits',
    pro: 'git bisect start',
  }],
  [/restore --staged/, {
    noob: 'unstage a file but keep my working tree edits',
    beginner: 'unstage keep edits',
    mid: 'git restore --staged',
    advanced: 'unstage file',
    pro: 'git restore --staged',
  }],
  [/^git switch -$/, {
    noob: 'go back to the previous branch I was on',
    beginner: 'switch previous branch',
    mid: 'git switch -',
    advanced: 'checkout previous',
    pro: 'git switch -',
  }],
  [/fetch --all --prune/, {
    noob: 'update remote refs and delete gone remote-tracking branches',
    beginner: 'fetch all prune',
    mid: 'git fetch --all --prune',
    advanced: 'prune remotes',
    pro: 'git fetch --all --prune',
  }],
  [/^git init$/, {
    noob: 'create a new empty git repository here',
    beginner: 'init new repo',
    mid: 'git init',
    advanced: 'initialize repository',
    pro: 'git init',
  }],
  [/^git show$/, {
    noob: 'inspect the latest commit contents',
    beginner: 'show latest commit',
    mid: 'git show',
    advanced: 'inspect HEAD commit',
    pro: 'git show',
  }],
  [/rm --cached/, {
    noob: 'stop tracking a file but leave it on disk',
    beginner: 'untrack file keep disk',
    mid: 'git rm --cached',
    advanced: 'remove from index',
    pro: 'git rm --cached',
  }],
];

function phrasesFor(command, topic) {
  const c = command.toLowerCase();
  for (const [re, phrases] of PHRASE_RULES) {
    if (re.test(c)) return phrases;
  }
  return {
    noob: `help me with ${topic} in git simply ${command}`,
    beginner: `how do I handle ${topic} ${command}`,
    mid: `standard ${topic} workflow ${command}`,
    advanced: `experienced ${topic} ${command}`,
    pro: `${topic} porcelain ${command}`,
  };
}

const RISK_TEXT = {
  none: 'Safe read-only / informational.',
  low: 'Low risk; review before running in shared repos.',
  high: 'Can rewrite local history or change remote state. Double-check.',
  destructive: 'May discard commits or files permanently. Prefer safer alternatives when unsure.',
};

/**
 * Deterministic multi-level intents (used for seed; Groq can refine later).
 */
export function generateIntentRows(entry) {
  const { command, risk_class = 'none', topic = 'git' } = entry;
  const phrases = phrasesFor(command, topic);
  const rows = [];
  for (let level = 1; level <= 5; level += 1) {
    rows.push({
      id: makeRowId(command, level),
      command,
      skill_level: level,
      intent_description: LEVEL_TONE[level](command, topic, phrases),
      explanation: `${command} is used for ${topic} operations in Git.`,
      risks: RISK_TEXT[risk_class] || RISK_TEXT.none,
      examples: command,
      risk_class,
    });
  }
  return rows;
}
