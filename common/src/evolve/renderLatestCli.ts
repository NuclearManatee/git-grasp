#!/usr/bin/env bun
// @ts-nocheck
import { mainRenderEvolveLatest } from './renderLatest.js';

try {
  mainRenderEvolveLatest();
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
}
