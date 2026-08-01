#!/usr/bin/env bun
// @ts-nocheck
/** Step 0: download all git-scm.com docs locally. */
import path from 'node:path';
import { PACKAGE_ROOT } from '@git-grasp/common';
import { downloadAllDocs } from '@git-grasp/common/catalog/downloadDocs.js';

console.log('Downloading git-scm.com documentation locallyÔÇª');
const { pages, mirror } = await downloadAllDocs({
  root: PACKAGE_ROOT,
  onPage: ({ url, bytes }) => console.log(`  ${url} (${bytes} bytes)`),
});
console.log(`Done: ${pages.length} pages, mirror hash ${mirror.hash}`);
