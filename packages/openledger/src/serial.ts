/**
 * Runs tasks one at a time. The ledger is SQLite with a single writer, and
 * several dev servers in one process share this queue, so overlapping `oled`
 * invocations would contend on the same database file.
 */
export const createSerialQueue = () => {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
};
