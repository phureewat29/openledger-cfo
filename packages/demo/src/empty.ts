import { runBare } from "./bare";
import { PERSONA } from "./persona";
import { exitWith } from "./report";

// The public empty start reads no dataset: the persona supplies the init config.
await exitWith(() => runBare(PERSONA));
