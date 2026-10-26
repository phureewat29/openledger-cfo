import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const WORKSPACE_MARKER = "pnpm-workspace.yaml";

// `dirname` of a filesystem root is that root, which is where the walk stops.
const findWorkspaceRoot = (dir: string): string | undefined => {
  if (existsSync(join(dir, WORKSPACE_MARKER))) return dir;
  const parent = dirname(dir);
  return parent === dir ? undefined : findWorkspaceRoot(parent);
};

/** Throws rather than returns: without a workspace there is no control plane to open. */
export const resolveDbPath = (): string => {
  const root = findWorkspaceRoot(process.cwd());
  if (root === undefined) {
    throw new Error(
      `Cannot locate the workspace root: no ${WORKSPACE_MARKER} above ${process.cwd()}.`,
    );
  }
  return join(root, "cfo.db");
};
