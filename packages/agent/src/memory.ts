import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { FilesystemBackend } from "deepagents";
import { memoize } from "es-toolkit";

import {
  findWorkspaceRoot,
  WORKSPACE_MARKER,
} from "@openledger-cfo/openledger";

/** Skill sources live with the code; the agent reads copies, never the sources. */
const SKILL_SOURCES = "packages/agent/src/skills";

const AGENT_DIR = ".cfo";

const SKILLS_MOUNT = "skills";

/** POSIX path, relative to the backend root, that the skills middleware scans. */
export const SKILLS_PATH = `/${SKILLS_MOUNT}/`;

/**
 * Every app in the monorepo reaches the same agent workspace, so its path is
 * derived from the workspace root rather than from each process's cwd.
 */
const workspaceRoot = (): string => {
  const root = findWorkspaceRoot(process.cwd());
  if (!root) {
    throw new Error(
      `Cannot locate the workspace root: no ${WORKSPACE_MARKER} above ${process.cwd()}.`,
    );
  }
  return root;
};

interface SkillsMount {
  readonly rootDir: string;
  readonly skillsDir: string;
}

/**
 * Skills reach the model through the backend, not the real filesystem, so the
 * source directory is copied into the agent's root. The skill's directory name
 * must equal the `name` in its frontmatter. Once per destination and process:
 * later agents share the copy rather than rewrite it under a run reading it.
 */
const mountSkills = memoize(
  ({ rootDir, skillsDir }: SkillsMount): void => {
    cpSync(
      join(workspaceRoot(), SKILL_SOURCES, skillsDir),
      join(rootDir, SKILLS_MOUNT, skillsDir),
      { recursive: true },
    );
  },
  { getCacheKey: ({ rootDir, skillsDir }) => join(rootDir, skillsDir) },
);

interface WorkspaceSpec {
  memoryNamespace: string;
  skillsDir: string;
}

/**
 * `virtualMode` is load-bearing: without it the agent's absolute paths resolve
 * against the real filesystem, skills silently fail to load, and file writes
 * escape the workspace.
 */
export const backendFor = (spec: WorkspaceSpec): FilesystemBackend => {
  const rootDir = join(workspaceRoot(), AGENT_DIR, spec.memoryNamespace);
  mkdirSync(rootDir, { recursive: true });
  mountSkills({ rootDir, skillsDir: spec.skillsDir });
  return new FilesystemBackend({ rootDir, virtualMode: true });
};
