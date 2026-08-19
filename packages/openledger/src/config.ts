import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { z } from "zod/v4";

import type { OledError } from "./errors";
import type { Result } from "./result";
import { safeJsonParse } from "./errors";
import { err, ok } from "./result";

const WORKSPACE_MARKER = "pnpm-workspace.yaml";

const findWorkspaceRoot = (start: string): string | undefined => {
  const { root } = parse(start);
  let dir = start;

  while (true) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) return dir;
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
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

/** The CLI writes "" to clear a key; to every reader that means unset. */
const unsetIfEmpty = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined || value === "" ? undefined : value,
  );

/** The config file is camelCase, unlike every command's output. */
const oledConfigFileSchema = z.looseObject({
  dataDir: z.string(),
  cacheDir: z.string(),
  ocrBaseUrl: unsetIfEmpty,
  ocrModel: unsetIfEmpty,
  ocrApiKey: unsetIfEmpty,
});
export type OledConfigFile = z.infer<typeof oledConfigFileSchema>;

/**
 * Reads the config file directly: the extraction artifacts live under cacheDir
 * and no command hands their directory back.
 */
export const readOledConfigFile = async (
  configPath: string,
): Promise<Result<OledConfigFile, OledError>> => {
  const text = await readFile(configPath, "utf8").catch(() => undefined);
  if (text === undefined) {
    return err<OledError>({
      kind: "not_configured",
      message: `No oled config at ${configPath}`,
      hint: "Run `oled config <path> --init`, or point OLED_CONFIG at an initialized ledger.",
    });
  }

  const parsed = oledConfigFileSchema.safeParse(safeJsonParse(text));
  if (!parsed.success) {
    return err<OledError>({
      kind: "parse_failed",
      message: `${configPath}: ${z.prettifyError(parsed.error)}`,
    });
  }
  return ok(parsed.data);
};
