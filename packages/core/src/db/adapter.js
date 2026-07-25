/**
 * Storage adapters keep Bun-native SQLite out of browser bundles.
 * CLI / seeding / eval use BunSqliteAdapter; web uses BrowserStubAdapter this PR.
 */

import { openDb, knnRecall, insertCommandRow, SCHEMA_VERSION } from './schema.js';

/**
 * @typedef {object} StorageAdapter
 * @property {string} name
 * @property {(dbPath: string) => unknown} open
 * @property {(handle: unknown, queryEmbedding: Float32Array, k: number) => object[]} knn
 * @property {(handle: unknown, row: object) => void} insert
 * @property {(handle: unknown) => void} close
 */

/** @type {StorageAdapter} */
export const BunSqliteAdapter = {
  name: 'bun-sqlite',
  open(dbPath) {
    const db = openDb(dbPath);
    return { _db: db, path: dbPath, schemaVersion: SCHEMA_VERSION };
  },
  knn(handle, queryEmbedding, k) {
    return knnRecall(handle, queryEmbedding, k);
  },
  insert(handle, row) {
    insertCommandRow(handle, row);
  },
  close(handle) {
    handle?._db?.close?.();
  },
};

/** @type {StorageAdapter} */
export const BrowserStubAdapter = {
  name: 'browser-stub',
  open() {
    const err = new Error(
      'Browser storage adapter not implemented yet. Use BunSqliteAdapter on the CLI, or ship a WASM follow-up.',
    );
    err.code = 'NOT_IMPLEMENTED';
    throw err;
  },
  knn() {
    const err = new Error('BrowserStubAdapter.knn is not implemented');
    err.code = 'NOT_IMPLEMENTED';
    throw err;
  },
  insert() {
    const err = new Error('BrowserStubAdapter.insert is not implemented');
    err.code = 'NOT_IMPLEMENTED';
    throw err;
  },
  close() {},
};

let activeAdapter = BunSqliteAdapter;

export function getStorageAdapter() {
  return activeAdapter;
}

/** @param {StorageAdapter} adapter */
export function setStorageAdapter(adapter) {
  activeAdapter = adapter;
  return activeAdapter;
}

export function useBunSqliteAdapter() {
  return setStorageAdapter(BunSqliteAdapter);
}

export function useBrowserStubAdapter() {
  return setStorageAdapter(BrowserStubAdapter);
}
