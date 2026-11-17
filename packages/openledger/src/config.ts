import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod/v4";

import type { OledError } from "./errors";
import type { Result } from "./result";
import { parseAs } from "./errors";
import { err, parseJson } from "./result";

export const WORKSPACE_MARKER = "pnpm-workspace.yaml";

// `dirname` of a filesystem root is that root, which is where the walk stops.
export const findWorkspaceRoot = (dir: string): string | undefined => {
  if (existsSync(join(dir, WORKSPACE_MARKER))) return dir;
  const parent = dirname(dir);
  return parent === dir ? undefined : findWorkspaceRoot(parent);
};

/**
 * Every app in the monorepo must reach the same ledger, so the config path is
 * derived from the workspace root rather than each process's cwd. Set
 * OLED_CONFIG to point at a different ledger (tests, throwaway fixtures).
 */
export const resolveOledConfig = (): string => {
  const fromEnv = process.env.OLED_CONFIG;
  if (fromEnv) return fromEnv;

  const root = findWorkspaceRoot(process.cwd());
  if (!root) {
    throw new Error(
      `Cannot locate the workspace root: no ${WORKSPACE_MARKER} above ${process.cwd()}. Set OLED_CONFIG to the oled config path.`,
    );
  }

  return join(root, ".oled/config.json");
};

/** The config file is camelCase, unlike every command's output. */
const oledConfigFileSchema = z.looseObject({
  dataDir: z.string(),
  cacheDir: z.string(),
});
type OledConfigFile = z.infer<typeof oledConfigFileSchema>;

export const notConfigured = (configPath: string): OledError => ({
  kind: "not_configured",
  message: `No oled config at ${configPath}`,
  hint: "Run `oled config <path> --init`, or point OLED_CONFIG at an initialized ledger.",
});

/**
 * Reads the config file directly: the extraction artifacts live under cacheDir
 * and no command hands their directory back.
 */
export const readOledConfigFile = async (
  configPath: string,
): Promise<Result<OledConfigFile, OledError>> => {
  const text = await readFile(configPath, "utf8").catch(() => undefined);
  if (text === undefined) return err(notConfigured(configPath));

  return parseAs(
    oledConfigFileSchema,
    parseJson(text),
    "parse_failed",
    configPath,
  );
};
