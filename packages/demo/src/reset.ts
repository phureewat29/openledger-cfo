import { runBare } from "./bare";
import { readLife } from "./dataset";
import { describeError, log } from "./report";

/**
 * The recovery hatch: both stores emptied, not refilled. Absent from the
 * README on purpose — `demo` is the documented way back. The dataset is still
 * read for the init config.
 */
const run = async (): Promise<number> => {
  const dataset = await readLife();
  if (!dataset.ok) {
    log(describeError(dataset.error));
    return 1;
  }
  return runBare(dataset.value.meta.config);
};

try {
  process.exitCode = await run();
} catch (cause) {
  console.error(cause);
  process.exitCode = 1;
}
