#!/usr/bin/env bun
import { buildProgram } from '../src/program.js';

const program = buildProgram();
await program.parseAsync(process.argv);
