// @ts-nocheck
/**
 * Static shell completion scripts for git-grasp.
 */

const COMMANDS = [
  'search',
  'doctor',
  'init',
  'config',
  'telemetry',
  'update-check',
  'set-level',
  'completion',
  'help',
];

const FLAGS = [
  '-v',
  '--verbose',
  '-c',
  '--copy',
  '--json',
  '-q',
  '--quiet',
  '-h',
  '--help',
  '-V',
  '--version',
];

export function completionScript(shell) {
  const s = String(shell || '').toLowerCase();
  if (s === 'bash') return bashCompletion();
  if (s === 'zsh') return zshCompletion();
  if (s === 'fish') return fishCompletion();
  if (s === 'powershell' || s === 'pwsh') return powershellCompletion();
  const err = new Error(`Unsupported shell: ${shell}. Use bash|zsh|fish|powershell`);
  err.code = 'USAGE';
  throw err;
}

function bashCompletion() {
  const cmds = COMMANDS.join(' ');
  const flags = FLAGS.join(' ');
  return `# git-grasp bash completion
_git_grasp() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [[ "\$prev" == "completion" ]]; then
    COMPREPLY=( \$(compgen -W "bash zsh fish powershell" -- "\$cur") )
    return
  fi
  if [[ "\$prev" == "config" ]]; then
    COMPREPLY=( \$(compgen -W "show path" -- "\$cur") )
    return
  fi
  if [[ "\$prev" == "telemetry" || "\$prev" == "update-check" ]]; then
    COMPREPLY=( \$(compgen -W "on off status" -- "\$cur") )
    return
  fi
  if [[ "\$cur" == -* ]]; then
    COMPREPLY=( \$(compgen -W "${flags}" -- "\$cur") )
    return
  fi
  COMPREPLY=( \$(compgen -W "${cmds}" -- "\$cur") )
}
complete -F _git_grasp git-grasp
`;
}

function zshCompletion() {
  return `#compdef git-grasp
_git_grasp() {
  local -a cmds
  cmds=(${COMMANDS.map((c) => `'${c}'`).join(' ')})
  _arguments \\
    '(-v --verbose)'{-v,--verbose}'[verbose]' \\
    '(-c --copy)'{-c,--copy}'[copy example]' \\
    '--json[JSON output]' \\
    '(-q --quiet)'{-q,--quiet}'[quiet]' \\
    '(-h --help)'{-h,--help}'[help]' \\
    '(-V --version)'{-V,--version}'[version]' \\
    '1:command:(${COMMANDS.join(' ')})' \\
    '*::arg:->args'
}
compdef _git_grasp git-grasp
`;
}

function fishCompletion() {
  const lines = [
    'complete -c git-grasp -f',
    ...COMMANDS.map(
      (c) => `complete -c git-grasp -n "__fish_use_subcommand" -a ${c}`,
    ),
    'complete -c git-grasp -n "__fish_seen_subcommand_from config" -a "show path"',
    'complete -c git-grasp -n "__fish_seen_subcommand_from telemetry update-check" -a "on off status"',
    'complete -c git-grasp -n "__fish_seen_subcommand_from completion" -a "bash zsh fish powershell"',
    'complete -c git-grasp -s v -l verbose -d "Verbose output"',
    'complete -c git-grasp -s c -l copy -d "Copy winning example"',
    'complete -c git-grasp -l json -d "JSON output"',
    'complete -c git-grasp -s q -l quiet -d "Quiet"',
    'complete -c git-grasp -s h -l help -d "Help"',
    'complete -c git-grasp -s V -l version -d "Version"',
  ];
  return `${lines.join('\n')}\n`;
}

function powershellCompletion() {
  return `Register-ArgumentCompleter -CommandName git-grasp -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $cmds = @(${COMMANDS.map((c) => `'${c}'`).join(', ')})
  $flags = @(${FLAGS.map((f) => `'${f}'`).join(', ')})
  if ($wordToComplete -like '-*') {
    $flags | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
    }
  } else {
    $cmds | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'Command', $_)
    }
  }
}
`;
}

export { COMMANDS, FLAGS };
