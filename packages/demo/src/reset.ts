import { runBare } from "./bare";
import { readLife } from "./dataset";
import { describeError, exitWith, log } from "./report";

// The recovery hatch, kept out of the README: `demo` is the documented way back.
const run = async (): Promise<number> => {
  const dataset = await readLife();
  if (!dataset.ok) {
    log(describeError(dataset.error));
    return 1;
  }
  return runBare(dataset.value.meta.config);
};

await exitWith(run);
