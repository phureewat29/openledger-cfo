import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { FilesystemBackend } from "deepagents";
import { memoize } from "es-toolkit";

import {
  findWorkspaceRoot,
  WORKSPACE_MARKER,
} from "@openledger-cfo/openledger";

import type { AgentKind } from "./registry";

/** Skill sources live with the code; the agent reads copies, never the sources. */
const SKILL_SOURCES = "packages/agent/src/skills";

const AGENT_DIR = ".cfo";

const SKILLS_MOUNT = "skills";

/** POSIX path, relative to the backend root, that the skills middleware scans. */
export const SKILLS_PATH = `/${SKILLS_MOUNT}/`;

/** Every app reaches the same agent workspace, so it hangs off the workspace root, not the cwd. */
const workspaceRoot = (): string => {
  const root = findWorkspaceRoot(process.cwd());
  if (!root) {
    throw new Error(
      `Cannot locate the workspace root: no ${WORKSPACE_MARKER} above ${process.cwd()}.`,
    );
  }
  return root;
};

/**
 * Skills reach the model through the backend, so they are copied into its root,
 * once per destination: later agents share the copy rather than rewrite it mid-read.
 */
const mountSkills = memoize(
  ({ source, destination }: { source: string; destination: string }): void => {
    cpSync(source, destination, { recursive: true });
  },
  { getCacheKey: ({ destination }) => destination },
);

/** Without `virtualMode`, paths hit the real disk: skills fail to load and writes escape. */
export const backendFor = (kind: AgentKind): FilesystemBackend => {
  const root = workspaceRoot();
  const rootDir = join(root, AGENT_DIR, kind);
  mkdirSync(rootDir, { recursive: true });
  mountSkills({
    source: join(root, SKILL_SOURCES, kind),
    destination: join(rootDir, SKILLS_MOUNT, kind),
  });
  return new FilesystemBackend({ rootDir, virtualMode: true });
};
