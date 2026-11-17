import { attemptAsync } from "es-toolkit";
import { z } from "zod/v4";

import type { Result } from "@openledger-cfo/openledger";
import { db } from "@openledger-cfo/db/client";
import { configuration } from "@openledger-cfo/db/schema";
import { err, messageOf, ok, unwrapOr } from "@openledger-cfo/openledger";

export const DEFAULT_AI_MODEL = "qwen/qwen3.8-27b";

/**
 * Test and save both parse this, so a value cannot test green and then fail
 * to save. An empty `apiKey` means a keyless endpoint.
 */
export const SaveGatewaySchema = z.object({
  baseUrl: z.url({ protocol: /^https?$/ }).max(400),
  apiKey: z.string().max(400).default(""),
  model: z.string().min(1).max(120).default(DEFAULT_AI_MODEL),
});

const CONFIG_ROW_ID = "app";

/** The agent package declares this shape too; they stay structurally equal. */
interface GatewayConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly redact: boolean;
}

export interface ConfigReadError {
  readonly reason: "missing-table" | "unavailable";
  readonly message: string;
}

type ConfigurationRow = typeof configuration.$inferSelect;

/** "no such table" = the db predates `pnpm db:push`: a setup state, not an outage. */
const toStoreError = (cause: unknown): ConfigReadError => {
  const message = messageOf(cause);
  return message.includes("no such table")
    ? {
        reason: "missing-table",
        message: "The configuration table is missing — run `pnpm db:push`.",
      }
    : { reason: "unavailable", message };
};

/** The store's one failure mapping: whatever the driver throws becomes data. */
const fromStore = async <T>(
  run: () => Promise<T>,
): Promise<Result<T, ConfigReadError>> => {
  const [cause, value] = await attemptAsync<T, Error>(run);
  return cause === null ? ok(value) : err(toStoreError(cause));
};

export const readConfigurationRow = (): Promise<
  Result<ConfigurationRow | undefined, ConfigReadError>
> =>
  fromStore(() =>
    db.query.configuration.findFirst({
      where: (table, { eq }) => eq(table.id, CONFIG_ROW_ID),
    }),
  );

/** A control-plane hiccup reads as "not configured", never a 500 — the layout and chat route sit on this. */
export const readGateway = async (): Promise<GatewayConfig | undefined> => {
  const row = unwrapOr(await readConfigurationRow(), undefined);
  if (row === undefined) return undefined;
  return {
    baseUrl: row.aiBaseUrl,
    apiKey: row.aiApiKey,
    model: row.aiModel,
    redact: row.aiRedact,
  };
};

/** `redact` omitted leaves the stored flag alone. */
export const saveConfiguration = async (input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  redact?: boolean;
}): Promise<Result<void, ConfigReadError>> => {
  const row = {
    aiBaseUrl: input.baseUrl,
    aiApiKey: input.apiKey,
    aiModel: input.model,
    ...(input.redact === undefined ? {} : { aiRedact: input.redact }),
  };
  return fromStore(async () => {
    await db
      .insert(configuration)
      .values({ id: CONFIG_ROW_ID, ...row })
      .onConflictDoUpdate({ target: configuration.id, set: row });
  });
};
