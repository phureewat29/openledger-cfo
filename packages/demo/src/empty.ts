/** The public empty start: bare ledger from the persona config, no dataset read. */
import { runBare } from "./bare";
import { PERSONA } from "./persona";

try {
  process.exitCode = await runBare(PERSONA);
} catch (cause) {
  console.error(cause);
  process.exitCode = 1;
}
