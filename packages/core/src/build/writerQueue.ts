/**
 * In-process single-writer queue for bun:sqlite during parallel build.
 */
export function createWriterQueue(db) {
  let chain = Promise.resolve();

  function run(fn) {
    const next = chain.then(() => fn(db));
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    run,
    insertCommand(row, insertFn) {
      return run((d) => insertFn(d, row));
    },
  };
}
