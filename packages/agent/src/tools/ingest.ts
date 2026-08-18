import type { StructuredToolInterface } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";

import type { IngestFileRow } from "@openledger-cfo/openledger";
import {
  ACCOUNT_ID_PATTERN,
  FILE_ID_PATTERN,
  ingestRowInputSchema,
} from "@openledger-cfo/openledger";

import type { ToolFailure } from "./caller";
import { caller, guardedRun, oledCommand, toolResult } from "./caller";

/** A statement runs to hundreds of pages; the model reads it in one bite. */
const MAX_DOCUMENT_CHARS = 60_000;

const MAX_ROWS = 500;

const fileId = z
  .string()
  .regex(FILE_ID_PATTERN)
  .describe("The sf-<uuid> ingestPrepare returned, never a path");

/** Tool input fields that must never be echoed back into the transcript. */
export const INGEST_SECRETS: Readonly<Record<string, readonly string[]>> = {
  ingestPrepare: ["password"],
};

export const ingestList = tool(
  async () =>
    guardedRun(async () => {
      const page = await caller.ledger.ingest.list();
      return toolResult({
        command: oledCommand("ingest", "list"),
        summary: page.summary,
        rows: page.rows.map((row) => ({
          rel_path: row.rel_path,
          file_id: row.file_id,
          status: row.status,
          encrypted: row.encrypted,
          note: row.note,
        })),
      });
    }),
  {
    name: "ingestList",
    description:
      "Statements sitting in the data directory and where each one stands: new, pending, ingested or failed. Start here.",
    schema: z.object({}),
    responseFormat: "content_and_artifact",
  },
);

export const ingestPrepare = tool(
  async (input) =>
    guardedRun(async () => {
      const out = await caller.ledger.ingest.prepare(input);
      if (!out.ok) return toolResult(out);

      // The extracted text can run to a megabyte; readDocument serves it capped.
      const { document, ...rest } = out;
      return toolResult({ ...rest, document_chars: document?.length ?? 0 });
    }),
  {
    name: "ingestPrepare",
    description:
      "Register one statement and extract its text or page images. Takes minutes on a scan. Returns the file id every later step needs, or an input-required refusal for a locked PDF.",
    schema: z.object({
      pathOrId: z
        .string()
        .min(1)
        .max(500)
        .describe("A rel_path from ingestList, or a file id to re-read"),
      password: z
        .string()
        .max(200)
        .optional()
        .describe("Only for a locked PDF, taken from the user"),
      rescan: z
        .boolean()
        .optional()
        .describe("Ignore the text layer and read the page images instead"),
      force: z
        .boolean()
        .optional()
        .describe("Re-register the file, dropping the prior ingest's rows"),
    }),
    responseFormat: "content_and_artifact",
  },
);

export const readDocument = tool(
  async ({ fileId: id }) =>
    guardedRun(async () => {
      const doc = await caller.ledger.ingest.document({ fileId: id });
      const text = doc.text.slice(0, MAX_DOCUMENT_CHARS);
      const truncated = doc.truncated || doc.text.length > MAX_DOCUMENT_CHARS;
      const content = truncated
        ? `${text}\n\n[truncated at ${String(MAX_DOCUMENT_CHARS)} characters of ${String(doc.text.length)}; re-read a later page range from the source]`
        : text;
      // The artifact leaves the text out: the transcript is not a statement viewer.
      return [
        content,
        {
          file_id: doc.file_id,
          page_count: doc.page_count,
          chars: text.length,
          truncated,
        },
      ] as [string, unknown];
    }),
  {
    name: "readDocument",
    description:
      "The statement text ingestPrepare extracted, ready to read row by row. Gone once the file is closed with ingestDone or ingestFail.",
    schema: z.object({ fileId }),
    responseFormat: "content_and_artifact",
  },
);

export const ingestCommit = tool(
  async (input) =>
    guardedRun(async () =>
      toolResult(await caller.ledger.ingest.commit(input)),
    ),
  {
    name: "ingestCommit",
    description:
      "Post statement rows to the ledger. Direction comes from the account pair, never from a sign: a card payment debits the card liability and credits the bank asset, a refund reverses the purchase's two accounts. Send whole pages at once, not a few rows per call.",
    schema: z.object({
      rows: z
        .array(ingestRowInputSchema)
        .min(1)
        .max(MAX_ROWS)
        .describe(
          "One row per statement line, each carrying row_index and source_page",
        ),
      fileId: fileId.optional(),
    }),
    responseFormat: "content_and_artifact",
  },
);

export const ingestDone = tool(
  async (input) =>
    guardedRun(async () => toolResult(await caller.ledger.ingest.done(input))),
  {
    name: "ingestDone",
    description:
      "Close a statement as ingested. With account and closingBalance it refuses to close unless the ledger balance matches the statement, which is how a misread amount gets caught.",
    schema: z.object({
      fileId,
      account: z
        .string()
        .regex(ACCOUNT_ID_PATTERN)
        .optional()
        .describe("The card or bank account the statement belongs to"),
      closingBalance: z
        .number()
        .optional()
        .describe("The closing balance the statement prints"),
    }),
    responseFormat: "content_and_artifact",
  },
);

/** The api caller throws real TRPCErrors, and the code is all this reads of one. */
const isNotFound = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === "NOT_FOUND";

const LOCKED_NOT_UNREADABLE =
  "refused: this file is locked, not unreadable — leave it where it is, the operator's password is the only thing that prepares it";

/**
 * A locked file is `pending` by the time anything can name it: a prepare with
 * no password refuses but registers the row anyway, with an id and no text —
 * and a `new` row has no id at all, so no fileId can reach one. A closed file
 * has no extraction either, which is what this status rules out.
 */
const OPEN_STATUSES = new Set<IngestFileRow["status"]>(["pending"]);

/**
 * From here a locked statement looks exactly like an unreadable one: nothing
 * extracted, nothing to post. Discarding one throws away a file a password
 * opens in a second, so the tool refuses instead of leaving the model to tell
 * the two apart.
 */
const lockedRefusal = async (
  fileId: string,
): Promise<ToolFailure | undefined> => {
  const missing = await caller.ledger.ingest.document({ fileId }).then(
    () => false,
    (cause: unknown) => isNotFound(cause),
  );
  if (!missing) return undefined;

  // A guard that cannot read the queue must not block the fail it guards.
  const page = await caller.ledger.ingest.list().catch(() => null);
  const row = page?.rows.find((candidate) => candidate.file_id === fileId);
  if (row === undefined || !row.encrypted || !OPEN_STATUSES.has(row.status)) {
    return undefined;
  }
  return { status: "error", message: LOCKED_NOT_UNREADABLE };
};

export const ingestFail = tool(
  async (input) =>
    guardedRun(async () => {
      const refused = await lockedRefusal(input.fileId);
      if (refused !== undefined) return toolResult(refused);
      return toolResult(await caller.ledger.ingest.fail(input));
    }),
  {
    name: "ingestFail",
    description:
      "Close a statement that cannot be read, with a note saying why. Use it instead of guessing at rows. A locked file is not an unreadable one — it refuses that one, because the operator's password still reads it.",
    schema: z.object({
      fileId,
      note: z.string().min(1).max(500),
    }),
    responseFormat: "content_and_artifact",
  },
);

/**
 * The files whose questions one run may touch, read at every call rather than
 * captured: a statement registered part-way through raises its questions under
 * an id the run did not hold when its tools were built.
 */
export type QuestionScope = () => ReadonlySet<string>;

/**
 * A question belongs to the file that raised it. One with no file at all was
 * raised by something other than this run, so it is out too.
 */
const inScope = (
  scope: QuestionScope | undefined,
  fileId: string | null,
): boolean => scope === undefined || (fileId !== null && scope().has(fileId));

/** The ledger's own ceiling, which is also more questions than a run can work. */
const MAX_QUESTIONS = 1000;

/**
 * Why this call may not go through, when it may not. Deferred questions count:
 * deferring hides one from the default list without resolving it. An id the
 * ledger has never heard of passes, so the CLI answers for it in its own words.
 */
const scopeRefusal = async (
  scope: QuestionScope | undefined,
  ids: readonly string[],
): Promise<ToolFailure | undefined> => {
  if (scope === undefined) return undefined;
  const page = await caller.ledger.questions.list({
    limit: MAX_QUESTIONS,
    includeDeferred: true,
  });
  const byId = new Map(page.rows.map((row) => [row.id, row.file_id]));
  const outside = ids.find((id) => {
    const raisedBy = byId.get(id);
    return raisedBy !== undefined && !inScope(scope, raisedBy);
  });
  if (outside === undefined) return undefined;
  return {
    status: "error",
    message: `question ${outside} is outside this run's files`,
  };
};

const questionsListTool = (scope?: QuestionScope): StructuredToolInterface =>
  tool(
    async (input) =>
      guardedRun(async () => {
        const page = await caller.ledger.questions.list(input);
        const rows = page.rows.filter((row) => inScope(scope, row.file_id));
        // The ledger pages before the scope is applied, so a scoped page counts
        // what it handed back rather than what the whole queue holds.
        const summary =
          scope === undefined
            ? page.summary
            : { ...page.summary, total: rows.length, returned: rows.length };
        return toolResult({
          command: oledCommand(
            "questions",
            "list",
            ...(input.includeDeferred === true ? ["--include-deferred"] : []),
          ),
          summary,
          rows: rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            prompt: row.prompt,
            account_id: row.account_id,
            transaction_id: row.transaction_id,
            file_id: row.file_id,
            context: row.context,
          })),
        });
      }),
    {
      name: "questionsList",
      description:
        "Open questions the ledger raised while posting rows, usually a transaction left uncategorized. They stay open until answered.",
      schema: z.object({
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
        includeDeferred: z.boolean().optional(),
      }),
      responseFormat: "content_and_artifact",
    },
  );

const answerQuestionTool = (scope?: QuestionScope): StructuredToolInterface =>
  tool(
    async ({ id, answer, also }) =>
      guardedRun(async () => {
        // `also` closes questions of its own, so it is scoped with the target.
        const refused = await scopeRefusal(scope, [id, ...(also ?? [])]);
        if (refused !== undefined) return toolResult(refused);
        return toolResult(
          await caller.ledger.questions.answer({ id, response: answer, also }),
        );
      }),
    {
      name: "answerQuestion",
      description:
        "Answer one open question, optionally closing sibling questions with the same answer in the same pass.",
      schema: z.object({
        id: z.string().min(1),
        answer: z
          .string()
          .min(1)
          .max(2000)
          .describe("Usually the account id the transaction belongs to"),
        also: z
          .array(z.string().min(1))
          .max(20)
          .optional()
          .describe("Sibling question ids this answer also closes"),
      }),
      responseFormat: "content_and_artifact",
    },
  );

const deferQuestionTool = (scope?: QuestionScope): StructuredToolInterface =>
  tool(
    async (input) =>
      guardedRun(async () => {
        const refused = await scopeRefusal(scope, [input.id]);
        if (refused !== undefined) return toolResult(refused);
        return toolResult(await caller.ledger.questions.defer(input));
      }),
    {
      name: "deferQuestion",
      description:
        "Push a question out by a number of days. Deferring does not resolve it; the ledger still counts it as open.",
      schema: z.object({
        id: z.string().min(1),
        days: z.number().int().min(1).max(365).optional(),
      }),
      responseFormat: "content_and_artifact",
    },
  );

export const questionsList = questionsListTool();
export const answerQuestion = answerQuestionTool();
export const deferQuestion = deferQuestionTool();

/** The same three, blind to every file but the ones the scope names. */
export const scopedQuestionTools = (
  ids: QuestionScope,
): StructuredToolInterface[] => [
  questionsListTool(ids),
  answerQuestionTool(ids),
  deferQuestionTool(ids),
];
