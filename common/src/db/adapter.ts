// @ts-nocheck
/**
 * Storage adapters keep Bun-native SQLite out of browser bundles.
 */
import {
  openDb,
  knnRecall,
  insertIntentWithEmbedding,
  insertCommand,
  insertRecipe,
  SCHEMA_VERSION,
} from './schema.js';

export const BunSqliteAdapter = {
  name: 'bun-sqlite',
  open(dbPath) {
    const db = openDb(dbPath);
    return { _db: db, path: dbPath, schemaVersion: SCHEMA_VERSION };
  },
  knn(handle, queryEmbedding, k, opts) {
    return knnRecall(handle, queryEmbedding, k, opts);
  },
  insert(handle, row) {
    if (row?.command_id && (row.intent_text || row.intent_description) && row.embedding) {
      insertIntentWithEmbedding(handle, row);
      return;
    }
    if (row?.command_recipe || row?.initial_state) {
      insertCommand(handle, row);
      return;
    }
    insertRecipe(handle, row);
  },
  close(handle) {
    handle?._db?.close?.();
  },
};

/** Browser builds use web-pack, not sqlite. */
export const BrowserStubAdapter = {
  name: 'browser-stub',
  open() {
    throw new Error('BrowserStubAdapter.open is unavailable â€” use @git-grasp/common/browser');
  },
  knn() {
    throw new Error('BrowserStubAdapter.knn is unavailable â€” use @git-grasp/common/browser');
  },
  insert() {
    throw new Error('BrowserStubAdapter.insert is unavailable');
  },
  close() {},
};

let current = BunSqliteAdapter;

export function getStorageAdapter() {
  return current;
}

export function setStorageAdapter(adapter) {
  current = adapter || BunSqliteAdapter;
  return current;
}

export function useBunSqliteAdapter() {
  return setStorageAdapter(BunSqliteAdapter);
}

export function useBrowserStubAdapter() {
  return setStorageAdapter(BrowserStubAdapter);
}

export { SCHEMA_VERSION };



