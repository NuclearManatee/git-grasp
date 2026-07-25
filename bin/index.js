#!/usr/bin/env node
import { buildProgram } from '../src/cli/program.js';

const program = buildProgram();
program.parseAsync(process.argv);
