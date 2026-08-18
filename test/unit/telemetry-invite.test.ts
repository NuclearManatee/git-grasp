import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import { promptTelemetryInvite } from '../../common/src/lib/telemetry/invite.ts';

describe('promptTelemetryInvite', () => {
  it('maps answers via questionFn', async () => {
    expect(await promptTelemetryInvite({ questionFn: async () => 'y' })).toBe('enable');
    expect(await promptTelemetryInvite({ questionFn: async () => 'yes' })).toBe('enable');
    expect(await promptTelemetryInvite({ questionFn: async () => 'd' })).toBe('dismiss');
    expect(await promptTelemetryInvite({ questionFn: async () => "don't" })).toBe('dismiss');
    expect(await promptTelemetryInvite({ questionFn: async () => 'n' })).toBe('disable');
    expect(await promptTelemetryInvite({ questionFn: async () => '' })).toBe('disable');
    expect(await promptTelemetryInvite({ questionFn: async () => 'maybe' })).toBe('disable');
  });

  it('skips when stdio is not a TTY', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    expect(await promptTelemetryInvite({ input, output })).toBe('skip');
  });

  it('reads from injected TTY streams via readline', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    Object.defineProperty(input, 'isTTY', { value: true });
    Object.defineProperty(output, 'isTTY', { value: true });
    const p = promptTelemetryInvite({ input, output });
    await Promise.resolve();
    input.write('dont\n');
    expect(await p).toBe('dismiss');
  });
});
