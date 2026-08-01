// @ts-nocheck
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import type { ZodType } from 'zod';

export class SchemaParseError extends Error {
  issues: unknown;
  constructor(message: string, issues?: unknown) {
    super(message);
    this.name = 'SchemaParseError';
    this.issues = issues;
  }
}

export function parseJson<S extends ZodType>(text: string, schema: S): z.infer<S> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SchemaParseError(`Invalid JSON: ${(e as Error).message}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new SchemaParseError(
      `Schema validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
      result.error.issues,
    );
  }
  return result.data;
}

export function readJsonFile<S extends ZodType>(
  filePath: string,
  schema: S,
  opts: { optional?: boolean; fallback?: z.infer<S> } = {},
): z.infer<S> {
  if (!existsSync(filePath)) {
    if (opts.optional && opts.fallback !== undefined) return opts.fallback;
    throw new SchemaParseError(`Missing file: ${filePath}`);
  }
  return parseJson(readFileSync(filePath, 'utf8'), schema);
}

export function readJsonl<S extends ZodType>(filePath: string, schema: S): Array<z.infer<S>> {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, 'utf8').split(/\n/).filter(Boolean);
  return lines.map((line, i) => {
    try {
      return parseJson(line, schema);
    } catch (e) {
      throw new SchemaParseError(
        `JSONL line ${i + 1} in ${filePath}: ${(e as Error).message}`,
        (e as SchemaParseError).issues,
      );
    }
  });
}
