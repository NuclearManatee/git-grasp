// @ts-nocheck
const ANSI_OSC = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const ANSI_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OTHER = /\u001b[@-Z\\-_]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Strip ANSI/OSC and other control chars from untrusted terminal text.
 */
export function stripAnsi(input) {
  if (input == null) return '';
  return String(input)
    .replace(ANSI_OSC, '')
    .replace(ANSI_CSI, '')
    .replace(ANSI_OTHER, '')
    .replace(CONTROL, '');
}

export function sanitizeField(input, maxLen = 4000) {
  const cleaned = stripAnsi(input).trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}
