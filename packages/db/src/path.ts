import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";

const WORKSPACE_MARKER = "pnpm-workspace.yaml";

export const resolveDbPath = (): string => {
  const { root } = parse(process.cwd());
  let dir = process.cwd();
  while (!existsSync(join(dir, WORKSPACE_MARKER))) {
    if (dir === root) {
      throw new Error(
        `Cannot locate the workspace root: no ${WORKSPACE_MARKER} above ${process.cwd()}.`,
      );
    }
    dir = dirname(dir);
  }
  return join(dir, "cfo.db");
};
