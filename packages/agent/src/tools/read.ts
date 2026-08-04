import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";

import { sanitizeLabel, sanitizeOptional } from "../sanitize";
import { caller, guardedRun, oledCommand, toolResult } from "./caller";

/** Raw ledger rows are wide; the model only ever needs these fields. */
const MAX_ROWS = 200;
const DEFAULT_ROWS = 50;

const isoDate = z.iso.date();

export const getReport = tool(
  async ({ from, to }) =>
    guardedRun(async () => {
      const report = await caller.ledger.report({ from, to });
      return toolResult({
        command: oledCommand("report", "--from", from, "--to", to),
        from: report.from,
        to: report.to,
        income: report.income,
        expenses: report.expenses,
        net: report.net,
      });
    }),
  {
    name: "getReport",
    description:
      "Total income, expenses and net for a date range, grouped by currency. Signed: a refund reduces expenses rather than adding income.",
    schema: z.object({
      from: isoDate.describe("Inclusive start date, YYYY-MM-DD"),
      to: isoDate.describe("Inclusive end date, YYYY-MM-DD"),
    }),
    responseFormat: "content_and_artifact",
  },
);

export const listTransactions = tool(
  async (filters) =>
    guardedRun(async () => {
      const limit = filters.limit ?? DEFAULT_ROWS;
      const page = await caller.ledger.transactions.list({ ...filters, limit });
      return toolResult({
        command: oledCommand(
          "transactions",
          "list",
          ...(filters.account === undefined
            ? []
            : ["--account", filters.account]),
          ...(filters.from === undefined ? [] : ["--from", filters.from]),
          ...(filters.to === undefined ? [] : ["--to", filters.to]),
          ...(filters.query === undefined ? [] : ["--query", filters.query]),
          "--limit",
          String(limit),
        ),
        total: page.summary?.total ?? page.rows.length,
        returned: page.rows.length,
        rows: page.rows.map((row) => ({
          id: row.id,
          date: row.date,
          description: sanitizeLabel(row.description),
          merchant: sanitizeOptional(row.merchant_name),
          amount: row.amount,
          currency: row.currency,
          debit: row.debit_account_id,
          credit: row.credit_account_id,
          source_file: row.source_file_id,
        })),
      });
    }),
  {
    name: "listTransactions",
    description:
      "Individual transactions, newest first, each with its tx: id and source statement file. Filter by account id (e.g. thb:expense:food:coffee), date range, or a text query against the description.",
    schema: z.object({
      account: z
        .string()
        .min(1)
        .optional()
        .describe("Full account id, e.g. thb:expense:subscriptions:streaming"),
      from: isoDate.optional(),
      to: isoDate.optional(),
      query: z
        .string()
        .min(1)
        .optional()
        .describe("Text match on the description"),
      limit: z.number().int().min(1).max(MAX_ROWS).optional(),
    }),
    responseFormat: "content_and_artifact",
  },
);

export const matchAccounts = tool(
  async ({ query }) =>
    guardedRun(async () => {
      const matches = await caller.ledger.accounts.match({ query });
      return toolResult({
        command: oledCommand("accounts", "match", "--query", query),
        rows: matches.rows.map((row) => ({
          id: row.account.id,
          name: sanitizeLabel(row.account.name),
          type: row.account.type,
          currency: row.account.currency,
          similarity: row.similarity,
        })),
      });
    }),
  {
    name: "matchAccounts",
    description:
      "Find existing accounts matching a name or purpose, best match first. Always check here before createAccount.",
    schema: z.object({ query: z.string().min(1).max(200) }),
    responseFormat: "content_and_artifact",
  },
);

export const listFiles = tool(
  async () =>
    guardedRun(async () => {
      const page = await caller.ledger.ingest.list();
      return toolResult({
        command: oledCommand("ingest", "list"),
        rows: page.rows.map((row) => ({
          path: row.rel_path,
          status: row.status,
          file_id: row.file_id,
        })),
      });
    }),
  {
    name: "listFiles",
    description:
      "Statement files the ledger knows: path, status (new, pending, ingested, failed, unreadable) and sf- file id.",
    schema: z.object({}),
    responseFormat: "content_and_artifact",
  },
);

export const listAccounts = tool(
  async () =>
    guardedRun(async () => {
      const accounts = await caller.ledger.accounts.list();
      const parentIds = new Set(
        accounts.rows
          .map((row) => row.parent_id)
          .filter((id): id is string => id !== null),
      );
      return toolResult({
        command: oledCommand("accounts", "list"),
        rows: accounts.rows
          .filter((row) => !parentIds.has(row.id))
          .map((row) => ({
            id: row.id,
            name: sanitizeLabel(row.name),
            type: row.type,
            currency: row.currency,
            balance: row.balance,
          })),
      });
    }),
  {
    name: "listAccounts",
    description:
      "Every account with its current balance. Assets and expenses are debit-positive; liabilities, income and equity are credit-positive. Parent accounts report zero.",
    schema: z.object({}),
    responseFormat: "content_and_artifact",
  },
);
