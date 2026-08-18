import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";

import {
  ACCOUNT_ID_PATTERN,
  FILE_ID_PATTERN,
} from "@openledger-cfo/openledger";

import { caller, guardedRun, toolResult } from "./caller";

const accountId = z
  .string()
  .regex(ACCOUNT_ID_PATTERN)
  .describe("Full account id, e.g. thb:liability:credit-card:ttb-absolute");

const txId = z
  .string()
  .min(1)
  .describe("The tx:<uuid> id listTransactions returned");

const isoDate = z.iso.date();

export const createAccount = tool(
  async (input) =>
    guardedRun(async () => {
      const created = await caller.ledger.accounts.create({
        id: input.id,
        name: input.name,
        type: input.type,
        parent_id: input.parent,
        subtype: input.subtype,
        bank_name: input.bank,
        account_number_masked: input.masked,
        due_day: input.dueDay,
        statement_day: input.statementDay,
      });
      return toolResult({
        command: created.command,
        id: created.id,
        created: created.created,
        created_parents: created.created_parents ?? [],
      });
    }),
  {
    name: "createAccount",
    description:
      "Create one account. Ids read <currency>:<type>:<path> and missing parents are created on the way. Run matchAccounts first — never create what already exists.",
    schema: z.object({
      id: accountId,
      name: z.string().min(1).max(200),
      type: z.enum(["asset", "liability", "income", "expense", "equity"]),
      parent: accountId.optional(),
      subtype: z.string().max(100).optional(),
      bank: z.string().max(200).optional().describe("Bank name"),
      masked: z.string().max(50).optional().describe("Masked account number"),
      dueDay: z.number().int().min(1).max(31).optional(),
      statementDay: z.number().int().min(1).max(31).optional(),
    }),
    responseFormat: "content_and_artifact",
  },
);

export const updateAccount = tool(
  async (input) =>
    guardedRun(async () => {
      const updated = await caller.ledger.accounts.update(input);
      return toolResult({ command: updated.command, id: updated.id });
    }),
  {
    name: "updateAccount",
    description:
      "Rename an account or set its card facts: due day, statement day, reward points, bank, masked number.",
    schema: z.object({
      id: accountId,
      name: z.string().min(1).max(200).optional(),
      dueDay: z.number().int().min(1).max(31).optional(),
      statementDay: z.number().int().min(1).max(31).optional(),
      points: z.number().optional(),
      bank: z.string().max(200).optional(),
      masked: z.string().max(50).optional(),
    }),
    responseFormat: "content_and_artifact",
  },
);

export const mergeAccounts = tool(
  async (input) =>
    guardedRun(async () => {
      const merged = await caller.ledger.accounts.merge(input);
      return toolResult({
        command: merged.command,
        from: merged.from,
        to: merged.to,
        moved: merged.moved,
      });
    }),
  {
    name: "mergeAccounts",
    description:
      "Merge one account into another on the same currency: every transaction moves and the from-account is deleted. Irreversible.",
    schema: z.object({ from: accountId, to: accountId }),
    responseFormat: "content_and_artifact",
  },
);

export const adjustBalance = tool(
  async (input) =>
    guardedRun(async () => {
      const adjusted = await caller.ledger.accounts.adjust(input);
      return toolResult({
        command: adjusted.command,
        transaction_id: adjusted.transaction_id,
        delta: adjusted.delta,
      });
    }),
  {
    name: "adjustBalance",
    description:
      "Post an adjustment that brings an account to a target balance, as a real transaction against the adjustments equity account with its reason on record. `to` means the balance as listAccounts reports it.",
    schema: z.object({
      id: accountId,
      to: z.number().finite().describe("Target balance"),
      reason: z.string().min(1).max(500),
      date: isoDate.optional(),
    }),
    responseFormat: "content_and_artifact",
  },
);

export const deleteAccount = tool(
  async (input) =>
    guardedRun(async () => {
      const deleted = await caller.ledger.accounts.delete(input);
      return toolResult({
        command: deleted.command,
        id: deleted.id,
        deleted: deleted.deleted,
      });
    }),
  {
    name: "deleteAccount",
    description:
      "Delete an account. The ledger refuses one that still has transactions — merge it first.",
    schema: z.object({ id: accountId }),
    responseFormat: "content_and_artifact",
  },
);

export const addTransaction = tool(
  async (input) =>
    guardedRun(async () => {
      const added = await caller.ledger.transactions.add({
        debit_account: input.debitAccount,
        credit_account: input.creditAccount,
        amount: input.amount,
        date: input.date,
        description: input.description,
        merchant_name: input.merchantName,
      });
      return toolResult({
        command: added.command,
        transaction_id: added.transaction_id,
        duplicate: added.duplicate,
      });
    }),
  {
    name: "addTransaction",
    description:
      "Post one manual double-entry row. Direction, never sign: debit the account that grows, amount always positive, both accounts on one currency.",
    schema: z.object({
      debitAccount: accountId,
      creditAccount: accountId,
      amount: z.number().positive().finite(),
      date: isoDate.optional().describe("Defaults to today"),
      description: z.string().min(1).max(500).optional(),
      merchantName: z.string().min(1).max(200).optional(),
    }),
    responseFormat: "content_and_artifact",
  },
);

export const updateTransaction = tool(
  async (input) =>
    guardedRun(async () => {
      const updated = await caller.ledger.transactions.update(input);
      return toolResult({
        command: updated.command,
        transaction_id: updated.transaction_id,
        updated: updated.updated,
      });
    }),
  {
    name: "updateTransaction",
    description:
      "Fix a transaction's date or description. Accounts and amount are immutable — move money by adding the corrected row and deleting the wrong one.",
    schema: z.object({
      id: txId,
      date: isoDate.optional(),
      description: z.string().min(1).max(500).optional(),
    }),
    responseFormat: "content_and_artifact",
  },
);

export const deleteTransaction = tool(
  async (input) =>
    guardedRun(async () => {
      const deleted = await caller.ledger.transactions.delete(input);
      return toolResult({
        command: deleted.command,
        transaction_id: deleted.transaction_id,
        deleted: deleted.deleted,
        unvoided: deleted.unvoided ?? 0,
      });
    }),
  {
    name: "deleteTransaction",
    description: "Delete one transaction, both legs together. Irreversible.",
    schema: z.object({ id: txId }),
    responseFormat: "content_and_artifact",
  },
);

export const recategorizeTransactions = tool(
  async (input) =>
    guardedRun(async () => {
      const moved = await caller.ledger.transactions.recategorize(input);
      return toolResult({
        command: moved.command,
        affected: moved.affected,
        skipped_currency_mismatch: moved.skipped_currency_mismatch ?? 0,
      });
    }),
  {
    name: "recategorizeTransactions",
    description:
      "Re-point EVERY transaction on one account onto another — the whole history, not a date range. For one misplaced statement, move rows one by one instead.",
    schema: z.object({ from: accountId, to: accountId }),
    responseFormat: "content_and_artifact",
  },
);

export const mergeTransactions = tool(
  async (input) =>
    guardedRun(async () => {
      const merged = await caller.ledger.transactions.merge(input);
      return toolResult({
        command: merged.command,
        from: merged.from,
        to: merged.to,
        voided: merged.voided,
      });
    }),
  {
    name: "mergeTransactions",
    description:
      "Merge a duplicate mirror transaction into its surviving twin; the from-row is voided, not deleted.",
    schema: z.object({ from: txId, to: txId }),
    responseFormat: "content_and_artifact",
  },
);

export const dropFile = tool(
  async (input) =>
    guardedRun(async () => {
      const dropped = await caller.ledger.files.drop(input);
      return toolResult({
        command: dropped.command,
        file_id: dropped.file_id,
        removed_transactions: dropped.removed_transactions,
        removed_questions: dropped.removed_questions,
      });
    }),
  {
    name: "dropFile",
    description:
      "Deregister a statement file by its sf- id: its rows and questions leave the ledger, the file stays on disk for re-ingest. Only for imports that are themselves unusable.",
    schema: z.object({ fileId: z.string().regex(FILE_ID_PATTERN) }),
    responseFormat: "content_and_artifact",
  },
);
