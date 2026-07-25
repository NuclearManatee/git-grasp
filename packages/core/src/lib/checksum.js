import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

export function writeChecksumFile(filePath, checksumPath = `${filePath}.sha256`) {
  const hash = sha256File(filePath);
  writeFileSync(checksumPath, `${hash}  ${filePath.split(/[/\\]/).pop()}\n`, 'utf8');
  return hash;
}

export function readChecksumFile(checksumPath) {
  const text = readFileSync(checksumPath, 'utf8').trim();
  const hash = text.split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error(`Invalid checksum file: ${checksumPath}`);
  }
  return hash.toLowerCase();
}

export function verifyFileChecksum(filePath, checksumPath = `${filePath}.sha256`) {
  if (!existsSync(filePath)) {
    return { ok: false, reason: 'missing_file' };
  }
  if (!existsSync(checksumPath)) {
    return { ok: false, reason: 'missing_checksum' };
  }
  const expected = readChecksumFile(checksumPath);
  const actual = sha256File(filePath);
  if (actual !== expected) {
    return { ok: false, reason: 'mismatch', expected, actual };
  }
  return { ok: true, hash: actual };
}
