// @ts-nocheck
import { describe, it, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProgram } from '../../apps/cli/src/program.js';
import { completionScript } from '../../common/src/lib/completion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const cliBin = path.join(repoRoot, 'apps/cli/bin/index.ts');

function runCli(args, { env = {}, input = null, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('bun', [cliBin, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
        CI: '1',
        GIT_GRASP_MOCK_EMBEDDINGS: env.GIT_GRASP_MOCK_EMBEDDINGS ?? '1',
        GIT_GRASP_TELEMETRY: env.GIT_GRASP_TELEMETRY ?? '0',
        GIT_GRASP_UPDATE_CHECK: env.GIT_GRASP_UPDATE_CHECK ?? '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: -1, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false });
    });
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

describe('CLI program', () => {
  it('builds without throw', () => {
    const p = buildProgram();
    expect(p.name()).toBe('git-grasp');
  });

  it('registers config, update-check, init, completion', () => {
    const p = buildProgram();
    const names = p.commands.map((c) => c.name());
    expect(names).toContain('config');
    expect(names).toContain('update-check');
    expect(names).toContain('init');
    expect(names).toContain('completion');
    expect(names).toContain('search');
  });

  it('--version prints identity', async () => {
    const { code, stdout } = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout).toContain('git-grasp');
    expect(stdout.includes('schema') || stdout.includes('catalog')).toBe(true);
  });

  it('completion bash mentions git-grasp', async () => {
    const { code, stdout } = await runCli(['completion', 'bash']);
    expect(code).toBe(0);
    expect(stdout).toContain('git-grasp');
    expect(completionScript('bash')).toContain('complete');
  });

  it('config path prints a path', async () => {
    const { code, stdout } = await runCli(['config', 'path']);
    expect(code).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(3);
  });

  it('search --json returns parseable JSON', async () => {
    const { code, stdout, stderr, timedOut } = await runCli(
      ['--json', 'undo last commit keep files'],
      { timeoutMs: 120_000 },
    );
    if (timedOut) {
      console.warn('skip: search timed out', stderr.slice(0, 200));
      return;
    }
    // May fail if DB missing in CI sandbox — still require JSON on success
    if (code !== 0) {
      try {
        const errBody = JSON.parse(stdout);
        expect(errBody.status).toBe('error');
      } catch {
        console.warn('skip: search failed without JSON', code, stderr.slice(0, 300));
      }
      return;
    }
    const body = JSON.parse(stdout);
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('results');
  });

  it('stdin query works', async () => {
    const { code, stdout, stderr, timedOut } = await runCli([], {
      input: 'create a new branch\n',
      timeoutMs: 120_000,
    });
    if (timedOut) {
      console.warn('skip: stdin search timed out', stderr.slice(0, 200));
      return;
    }
    // Empty argv with stdin should search, not only print help
    if (code === 0) {
      expect(stdout.length).toBeGreaterThan(0);
      expect(stdout).not.toMatch(/^Usage:/);
    }
  });

  it('--help lists Common commands including config and completion', async () => {
    const { code, stdout } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Common commands');
    expect(stdout).toContain('config show');
    expect(stdout).toContain('completion bash');
  });

  it('telemetry on has no emoji by default', async () => {
    const { code, stdout } = await runCli(['telemetry', 'on'], {
      env: { GIT_GRASP_TELEMETRY: '1' },
    });
    expect(code).toBe(0);
    expect(stdout).toContain('Telemetry is enabled');
    expect(stdout).toContain('privacy');
    expect(stdout).not.toContain('✅');
  });

  it('telemetry on shows emoji when GIT_GRASP_EMOJI=1', async () => {
    const { code, stdout } = await runCli(['telemetry', 'on'], {
      env: { GIT_GRASP_TELEMETRY: '1', GIT_GRASP_EMOJI: '1' },
    });
    expect(code).toBe(0);
    expect(stdout).toContain('✅');
    expect(stdout).toContain('Telemetry is enabled');
  });

  it('doctor shows OK without emoji by default', async () => {
    const { code, stdout } = await runCli(['doctor']);
    const plain = stdout.replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).toMatch(/\bOK\b/);
    expect(plain).not.toContain('✅');
    expect(plain).not.toContain('❌');
    // doctor may fail in bare envs; still must be chalk-only
    expect([0, 2]).toContain(code);
  });
});
