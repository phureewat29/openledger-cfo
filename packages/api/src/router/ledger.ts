import { z } from "zod/v4";

import {
  ACCOUNT_ID_PATTERN,
  accountCreateInputSchema,
  FILE_ID_PATTERN,
  ingestRowInputSchema,
  transactionAddInputSchema,
} from "@openledger-fleet/openledger";

import { listCliLog } from "../cli-log";
import { DEMO_HINT, unwrapOrTrpc } from "../result";
import { createTRPCRouter, publicProcedure } from "../trpc";

const isoDate = z.iso.date();

const transactionFilters = z.object({
  account: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  query: z.string().min(1).optional(),
  currency: z.string().length(3).optional(),
});

const pagedFilters = transactionFilters.extend({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

const fileId = z.string().regex(FILE_ID_PATTERN);
const accountId = z.string().regex(ACCOUNT_ID_PATTERN);
const txId = z.string().min(1).max(100);
const accountPair = z.object({ from: accountId, to: accountId });

export const ledgerRouter = createTRPCRouter({
  status: publicProcedure.query(async ({ ctx }) =>
    unwrapOrTrpc(await ctx.ledger.status(), {
      notConfiguredMessage: DEMO_HINT,
    }),
  ),
  report: publicProcedure
    .input(z.object({ from: isoDate, to: isoDate }))
    .query(async ({ ctx, input }) =>
      unwrapOrTrpc(await ctx.ledger.report(input)),
    ),
  transactions: createTRPCRouter({
    list: publicProcedure
      .input(pagedFilters.optional())
      .query(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.transactions.list(input ?? {})),
      ),
    listAll: publicProcedure
      .input(transactionFilters.optional())
      .query(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.transactions.listAll(input ?? {})),
      ),
    /** The rows one statement posted. The CLI has no file filter, so this scans. */
    listByFile: publicProcedure
      .input(z.object({ fileId }))
      .query(async ({ ctx, input }) => {
        const rows = unwrapOrTrpc(await ctx.ledger.transactions.listAll({}));
        return rows.filter((row) => row.source_file_id === input.fileId);
      }),
    add: publicProcedure
      .input(transactionAddInputSchema)
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.transactions.add(input)),
      ),
    update: publicProcedure
      .input(
        z.object({
          id: txId,
          date: isoDate.optional(),
          description: z.string().min(1).max(500).optional(),
          merchant: z.string().min(1).max(100).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...patch } = input;
        return unwrapOrTrpc(await ctx.ledger.transactions.update(id, patch));
      }),
    delete: publicProcedure
      .input(z.object({ id: txId }))
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.transactions.delete(input.id)),
      ),
    recategorize: publicProcedure
      .input(accountPair)
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.transactions.recategorize(input)),
      ),
    merge: publicProcedure
      .input(z.object({ from: txId, to: txId }))
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.transactions.merge(input)),
      ),
  }),
  accounts: createTRPCRouter({
    list: publicProcedure.query(async ({ ctx }) =>
      unwrapOrTrpc(await ctx.ledger.accounts.list()),
    ),
    match: publicProcedure
      .input(z.object({ query: z.string().min(1).max(200) }))
      .query(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.accounts.match(input.query)),
      ),
    create: publicProcedure
      .input(accountCreateInputSchema)
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.accounts.create(input)),
      ),
    update: publicProcedure
      .input(
        z.object({
          id: accountId,
          name: z.string().min(1).max(200).optional(),
          dueDay: z.number().int().min(1).max(31).optional(),
          statementDay: z.number().int().min(1).max(31).optional(),
          points: z.number().optional(),
          bank: z.string().max(200).optional(),
          masked: z.string().max(50).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(
          await ctx.ledger.accounts.update(input.id, {
            name: input.name,
            due_day: input.dueDay,
            statement_day: input.statementDay,
            points: input.points,
            bank_name: input.bank,
            account_number_masked: input.masked,
          }),
        ),
      ),
    merge: publicProcedure
      .input(accountPair)
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.accounts.merge(input)),
      ),
    adjust: publicProcedure
      .input(
        z.object({
          id: accountId,
          to: z.number().finite(),
          reason: z.string().min(1).max(500),
          date: isoDate.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...opts } = input;
        return unwrapOrTrpc(await ctx.ledger.accounts.adjust(id, opts));
      }),
    delete: publicProcedure
      .input(z.object({ id: accountId }))
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.accounts.delete(input.id)),
      ),
  }),
  questions: createTRPCRouter({
    list: publicProcedure
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(1000).optional(),
            offset: z.number().int().min(0).optional(),
            includeDeferred: z.boolean().optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.questions.list(input ?? {})),
      ),
    answer: publicProcedure
      .input(
        z.object({
          id: z.string().min(1),
          response: z.string().min(1).max(2000),
          also: z.array(z.string().min(1)).max(20).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(
          await ctx.ledger.questions.answer(input.id, input.response, {
            also: input.also,
          }),
        ),
      ),
    defer: publicProcedure
      .input(
        z.object({
          id: z.string().min(1),
          days: z.number().int().min(1).max(365).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(
          await ctx.ledger.questions.defer(input.id, { days: input.days }),
        ),
      ),
  }),
  ingest: createTRPCRouter({
    list: publicProcedure.query(async ({ ctx }) =>
      unwrapOrTrpc(await ctx.ledger.ingest.list()),
    ),
    document: publicProcedure
      .input(z.object({ fileId }))
      .query(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.ingest.document(input.fileId)),
      ),
    prepare: publicProcedure
      .input(
        z.object({
          pathOrId: z.string().min(1).max(500),
          password: z.string().max(200).optional(),
          rescan: z.boolean().optional(),
          force: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { pathOrId, ...opts } = input;
        const out = await ctx.ledger.ingest.prepare(pathOrId, opts);
        if (!out.ok && out.error.kind === "input_required") {
          return {
            ok: false as const,
            reason: "input-required" as const,
            message: out.error.message,
          };
        }
        return { ok: true as const, ...unwrapOrTrpc(out) };
      }),
    commit: publicProcedure
      .input(
        z.object({
          rows: z.array(ingestRowInputSchema).min(1).max(500),
          fileId: fileId.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const out = await ctx.ledger.ingest.commit(input.rows, {
          fileId: input.fileId,
        });
        if (!out.ok && out.error.kind === "partial") {
          return {
            ok: false as const,
            reason: "partial" as const,
            message: out.error.message,
            failures: out.error.failures ?? [],
          };
        }
        return { ok: true as const, ...unwrapOrTrpc(out) };
      }),
    done: publicProcedure
      .input(
        z.object({
          fileId,
          account: z.string().optional(),
          closingBalance: z.number().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { fileId: id, ...opts } = input;
        const out = await ctx.ledger.ingest.done(id, opts);
        if (!out.ok && out.error.kind === "invalid") {
          return {
            ok: false as const,
            reason: "mismatch" as const,
            // The corrective travels with the refusal so a caller that only
            // reads messages still learns the one move that closes the file.
            message: `${out.error.message} — the rows are already posted; close again with only the fileId.`,
          };
        }
        return { ok: true as const, ...unwrapOrTrpc(out) };
      }),
    fail: publicProcedure
      .input(z.object({ fileId, note: z.string().min(1).max(500) }))
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.ingest.fail(input.fileId, input.note)),
      ),
  }),
  files: createTRPCRouter({
    /** Deregisters the file and everything the ledger hung off it. */
    drop: publicProcedure
      .input(z.object({ fileId }))
      .mutation(async ({ ctx, input }) =>
        unwrapOrTrpc(await ctx.ledger.files.drop(input.fileId)),
      ),
  }),
  cliLog: publicProcedure
    .input(z.object({ after: z.number().int().optional() }).optional())
    .query(({ input }) => listCliLog(input?.after)),
});
