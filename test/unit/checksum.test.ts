// @ts-nocheck
import { describe, it, expect } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sha256Buffer, writeChecksumFile, verifyFileChecksum, readChecksumFile,
} from '../../common/src/lib/checksum.js';

const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), '../tmp-checksum');

describe('checksum', () => {
  it('hashes buffers', () => {
    expect(sha256Buffer(Buffer.from('abc'))).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies matching checksum', () => {
    mkdirSync(tmp, { recursive: true });
    const f = path.join(tmp, 'a.bin');
    writeFileSync(f, 'hello');
    writeChecksumFile(f);
    expect(verifyFileChecksum(f).ok).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('detects mismatch', () => {
    mkdirSync(tmp, { recursive: true });
    const f = path.join(tmp, 'b.bin');
    writeFileSync(f, 'hello');
    writeChecksumFile(f);
    writeFileSync(f, 'HELLO');
    expect(verifyFileChecksum(f).ok).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reports missing file/checksum and invalid hash', () => {
    mkdirSync(tmp, { recursive: true });
    expect(verifyFileChecksum(path.join(tmp, 'nope.bin')).reason).toBe('missing_file');
    const f = path.join(tmp, 'c.bin');
    writeFileSync(f, 'x');
    expect(verifyFileChecksum(f).reason).toBe('missing_checksum');
    const bad = path.join(tmp, 'c.bin.sha256');
    writeFileSync(bad, 'not-a-hash\n');
    expect(() => readChecksumFile(bad)).toThrow(/Invalid checksum file/);
    rmSync(tmp, { recursive: true, force: true });
  });
});
