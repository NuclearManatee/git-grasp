#!/usr/bin/env bun
// @ts-nocheck
/**
 * Install-time bench under simulated slow network (tc netem).
 * Not part of the 500ms search gate.
 *
 * Linux container expected. On non-Linux hosts, prints guidance and exits 0
 * unless --require-tc is set.
 *
 * Usage:
 *   bun run bench:install
 *   bun run bench:install -- --rate 5mbit --require-tc
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PACKAGE_ROOT } from '@git-grasp/common';

function parseArgs(argv) {
  const out = { rate: '5mbit', requireTc: false, skipModel: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--rate') out.rate = argv[++i];
    else if (a === '--require-tc') out.requireTc = true;
    else if (a === '--skip-model') out.skipModel = true;
  }
  return out;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: opts.env || process.env,
    stdio: opts.stdio || 'pipe',
  });
  return r;
}

function hasTc() {
  const r = run('sh', ['-c', 'command -v tc && command -v ip']);
  return r.status === 0;
}

function applyNetem(rate) {
  // Best-effort: throttle egress on eth0/default iface
  const iface = run('sh', ['-c', "ip route | awk '/default/ {print $5; exit}'"]);
  const ifname = (iface.stdout || 'eth0').trim() || 'eth0';
  run('tc', ['qdisc', 'del', 'dev', ifname, 'root']);
  const add = run('tc', [
    'qdisc', 'add', 'dev', ifname, 'root', 'handle', '1:', 'tbf',
    'rate', rate, 'burst', '32kbit', 'latency', '400ms',
  ]);
  if (add.status !== 0) {
    throw new Error(`tc failed on ${ifname}: ${add.stderr || add.stdout}`);
  }
  return ifname;
}

function clearNetem(ifname) {
  run('tc', ['qdisc', 'del', 'dev', ifname, 'root']);
}

async function warmModel() {
  const t0 = performance.now();
  const { getEmbedder } = await import('@git-grasp/common');
  const embedder = await getEmbedder({ forceMock: false });
  await embedder.embed('warmup');
  return performance.now() - t0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const platform = process.platform;

  if (platform !== 'linux') {
    const msg = `bench:install expects Linux (tc netem). Current: ${platform}. Use Docker compose profile install.`;
    if (opts.requireTc) {
      console.error(msg);
      process.exit(1);
    }
    console.log(msg);
    console.log('Skipping local install throttle; see docs/perf.md');
    process.exit(0);
  }

  if (!hasTc()) {
    const msg = 'tc/ip not available ÔÇö install iproute2 or run inside the install bench container';
    if (opts.requireTc) {
      console.error(msg);
      process.exit(1);
    }
    console.log(msg);
    process.exit(0);
  }

  let ifname = null;
  const work = mkdtempSync(path.join(tmpdir(), 'git-grasp-install-'));
  try {
    ifname = applyNetem(opts.rate);
    console.log(`Throttled ${ifname} to ${opts.rate}`);

    // Minimal copy for install timing: package manifests + lock + scripts
    const files = [
      'package.json',
      'bun.lock',
      'common/scripts/postinstall.ts',
      'common',
      'apps',
    ];
    for (const f of files) {
      const src = path.join(PACKAGE_ROOT, f);
      if (!existsSync(src)) continue;
      cpSync(src, path.join(work, f), { recursive: true });
    }

    const tInstall0 = performance.now();
    const install = run('bun', ['install', '--frozen-lockfile'], {
      cwd: work,
      env: {
        ...process.env,
        GIT_GRASP_SKIP_POSTINSTALL: opts.skipModel ? '1' : '0',
        GIT_GRASP_MOCK_EMBEDDINGS: opts.skipModel ? '1' : undefined,
      },
      stdio: 'inherit',
    });
    const installMs = performance.now() - tInstall0;
    if (install.status !== 0) {
      throw new Error(`bun install failed with ${install.status}`);
    }

    let modelMs = null;
    if (!opts.skipModel) {
      process.chdir(work);
      modelMs = await warmModel();
    }

    const report = {
      at: new Date().toISOString(),
      rate: opts.rate,
      iface: ifname,
      bunInstallMs: installMs,
      modelWarmMs: modelMs,
      totalMs: installMs + (modelMs || 0),
    };
    console.log(JSON.stringify(report, null, 2));
    mkdirSync(path.join(PACKAGE_ROOT, 'local', 'bench'), { recursive: true });
    writeFileSync(
      path.join(PACKAGE_ROOT, 'local', 'bench', 'install-last.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } finally {
    if (ifname) {
      try { clearNetem(ifname); } catch { /* ignore */ }
    }
    try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

await main();
