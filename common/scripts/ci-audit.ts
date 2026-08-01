#!/usr/bin/env bun
/**
 * CI audit gate: fail on high/critical. Prefer empty allowlist.
 * Uses `bun audit --json` (package → advisory[] map).
 */
import { execFileSync } from 'node:child_process';

export type Advisory = {
  severity?: string;
  title?: string;
  id?: string;
};

export type Finding = [string, Advisory];

export type AuditGateResult = {
  ok: boolean;
  unexpected: Finding[];
  allowedHighs: Finding[];
  highs: Finding[];
};

export type AuditLog = {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type RunAuditGateDeps = {
  runAudit: () => string;
  allowed?: Set<string>;
  log?: AuditLog;
};

/** Strip optional bun version banner, then JSON.parse. */
export function parseAuditOutput(stdout: string): unknown {
  const start = stdout.indexOf('{');
  const json = start >= 0 ? stdout.slice(start) : stdout;
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('Could not parse bun audit JSON');
  }
}

/** Flatten package → advisory[] map; skip non-array values. */
export function collectFindings(report: unknown): Finding[] {
  if (!report || typeof report !== 'object') return [];
  const findings: Finding[] = [];
  for (const [name, advisories] of Object.entries(report as Record<string, unknown>)) {
    if (!Array.isArray(advisories)) continue;
    for (const adv of advisories) {
      findings.push([name, (adv ?? {}) as Advisory]);
    }
  }
  return findings;
}

export function evaluateAuditGate(
  findings: Finding[],
  allowed: Set<string> = new Set(),
): AuditGateResult {
  const highs = findings.filter(
    ([, v]) => v.severity === 'high' || v.severity === 'critical',
  );
  const unexpected = highs.filter(([name]) => !allowed.has(name));
  const allowedHighs = highs.filter(([name]) => allowed.has(name));
  return {
    ok: unexpected.length === 0,
    unexpected,
    allowedHighs,
    highs,
  };
}

export function formatUnexpected(unexpected: Finding[]): string[] {
  return unexpected.map(
    ([n, a]) => `${n} (${a.title || a.id || a.severity})`,
  );
}

export function formatAllowedHighs(allowedHighs: Finding[]): string {
  return allowedHighs
    .map(([n, a]) => `${n}:${a.id || a.title || a.severity}`)
    .join(', ');
}

/**
 * Run bun audit (or injected runner), evaluate gate, log, return exit code.
 * When `runAudit` throws, still reads `error.stdout` (bun often exits non-zero with findings).
 */
export function runAuditGate(deps: RunAuditGateDeps): number {
  const allowed = deps.allowed ?? new Set<string>();
  const log = deps.log ?? console;

  let out = '';
  try {
    out = deps.runAudit();
  } catch (e: unknown) {
    const err = e as { stdout?: string | Buffer };
    out = err.stdout?.toString?.() || (typeof err.stdout === 'string' ? err.stdout : '') || '';
  }

  let report: unknown;
  try {
    report = parseAuditOutput(out);
  } catch {
    log.error('Could not parse bun audit JSON');
    return 1;
  }

  const findings = collectFindings(report);
  const result = evaluateAuditGate(findings, allowed);

  if (!result.ok) {
    log.error(
      'Unexpected high/critical vulnerabilities:',
      formatUnexpected(result.unexpected),
    );
    return 1;
  }

  if (result.allowedHighs.length) {
    log.warn(
      'Allowed known advisories (must bump soon):',
      formatAllowedHighs(result.allowedHighs),
    );
  }
  log.log('Audit gate passed');
  return 0;
}

/** Temporary exceptions only — keep empty when possible. */
export const DEFAULT_ALLOWED = new Set<string>();

export function defaultRunAudit(): string {
  return execFileSync(process.execPath, ['audit', '--json'], {
    encoding: 'utf8',
  });
}

if (import.meta.main) {
  process.exit(
    runAuditGate({
      runAudit: defaultRunAudit,
      allowed: DEFAULT_ALLOWED,
    }),
  );
}
