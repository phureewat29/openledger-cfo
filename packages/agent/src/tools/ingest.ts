import { attemptAsync, omit, sumBy } from "es-toolkit";
import { z } from "zod/v4";

import { caller, oledCauseOf } from "@openledger-cfo/api";
import {
  accountIdSchema,
  fileIdSchema,
  ingestRowInputSchema,
} from "@openledger-cfo/openledger";

import type { ToolFailure } from "./guarded";
import { guardedTool, oledCommand, toolResult } from "./guarded";

const MAX_DOCUMENT_CHARS = 60_000;

const MAX_ROWS = 500;

const fileId = fileIdSchema.describe(
  "The sf-<uuid> ingestPrepare returned, never a path",
);

/** Tool input fields that must never be echoed back into the transcript. */
export const INGEST_SECRETS: Readonly<Record<string, readonly string[]>> = {
  ingestPrepare: ["password"],
};

export const ingestList = guardedTool(
  async () => {
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
  },
  {
    name: "ingestList",
    description:
      "Statements sitting in the data directory and where each one stands: new, pending, ingested or failed. Start here.",
    schema: z.object({}),
  },
);

export const ingestPrepare = guardedTool(
  async (input) => {
    const out = await caller.ledger.ingest.prepare(input);
    if (!out.ok) return toolResult(out);

    // readDocument serves the text itself, capped.
    return toolResult({
      ...omit(out, ["document"]),
      document_chars: sumBy(out.pages, (page) => page.chars),
    });
  },
  {
    name: "ingestPrepare",
    description:
      "Register one statement and extract its text. The built-in OCR reads scans and photos: printed Thai and English, not handwriting. Returns the file id every later step needs, or an input-required refusal for a locked PDF.",
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
        .describe("Ignore a garbled text layer and read every page with OCR"),
      force: z
        .boolean()
        .optional()
        .describe("Re-register the file, dropping the prior ingest's rows"),
    }),
  },
);

export const readDocument = guardedTool(
  async ({ fileId: id }) => {
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
    ];
  },
  {
    name: "readDocument",
    description:
      "The statement text ingestPrepare extracted, ready to read row by row. Gone once the file is closed with ingestDone or ingestFail.",
    schema: z.object({ fileId }),
  },
);

export const ingestCommit = guardedTool(
  async (input) => toolResult(await caller.ledger.ingest.commit(input)),
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
  },
);

export const ingestDone = guardedTool(
  async (input) => toolResult(await caller.ledger.ingest.done(input)),
  {
    name: "ingestDone",
    description:
      "Close a statement as ingested. With account and closingBalance it refuses to close unless the ledger balance matches the statement, which is how a misread amount gets caught.",
    schema: z.object({
      fileId,
      account: accountIdSchema
        .optional()
        .describe("The card or bank account the statement belongs to"),
      closingBalance: z
        .number()
        .optional()
        .describe("The closing balance the statement prints"),
    }),
  },
);

const LOCKED_NOT_UNREADABLE =
  "refused: this file is locked, not unreadable — leave it where it is, the operator's password is the only thing that prepares it";

/**
 * A locked file has no extraction, so it reads as unreadable; failing it would
 * discard what a password opens. A prepare without one leaves the row `pending`.
 */
const lockedRefusal = async (
  fileId: string,
): Promise<ToolFailure | undefined> => {
  const [cause] = await attemptAsync(() =>
    caller.ledger.ingest.document({ fileId }),
  );
  if (oledCauseOf(cause)?.kind !== "not_found") return undefined;

  // A guard that cannot read the queue must not block the fail it guards.
  const [, page] = await attemptAsync(() => caller.ledger.ingest.list());
  const row = page?.rows.find((candidate) => candidate.file_id === fileId);
  if (row === undefined || !row.encrypted || row.status !== "pending") {
    return undefined;
  }
  return { status: "error", message: LOCKED_NOT_UNREADABLE };
};

export const ingestFail = guardedTool(
  async (input) => {
    const refused = await lockedRefusal(input.fileId);
    if (refused !== undefined) return toolResult(refused);
    return toolResult(await caller.ledger.ingest.fail(input));
  },
  {
    name: "ingestFail",
    description:
      "Close a statement that cannot be read, with a note saying why. Use it instead of guessing at rows. A locked file is not an unreadable one — it refuses that one, because the operator's password still reads it.",
    schema: z.object({
      fileId,
      note: z.string().min(1).max(500),
    }),
  },
);

/** Read at every call: a file registered mid-run raises questions under a new id. */
export type QuestionScope = () => ReadonlySet<string>;

/** A question with no file was raised by something other than this run. */
const inScope = (
  scope: QuestionScope | undefined,
  fileId: string | null,
): boolean => scope === undefined || (fileId !== null && scope().has(fileId));

/** The ledger's own ceiling. */
const MAX_QUESTIONS = 1000;

/**
 * Deferred questions count, since deferring does not resolve one. An unknown id
 * passes, so the CLI answers for it in its own words.
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

const questionsListTool = (scope?: QuestionScope) =>
  guardedTool(
    async (input) => {
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
    },
    {
      name: "questionsList",
      description:
        "Open questions the ledger raised while posting rows, usually a transaction left uncategorized. They stay open until answered.",
      schema: z.object({
        limit: z.number().int().min(1).max(MAX_QUESTIONS).optional(),
        offset: z.number().int().min(0).optional(),
        includeDeferred: z.boolean().optional(),
      }),
    },
  );

const answerQuestionTool = (scope?: QuestionScope) =>
  guardedTool(
    async ({ id, answer, also }) => {
      // `also` closes questions of its own, so it is scoped with the target.
      const refused = await scopeRefusal(scope, [id, ...(also ?? [])]);
      if (refused !== undefined) return toolResult(refused);
      return toolResult(
        await caller.ledger.questions.answer({ id, response: answer, also }),
      );
    },
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
    },
  );

const deferQuestionTool = (scope?: QuestionScope) =>
  guardedTool(
    async (input) => {
      const refused = await scopeRefusal(scope, [input.id]);
      if (refused !== undefined) return toolResult(refused);
      return toolResult(await caller.ledger.questions.defer(input));
    },
    {
      name: "deferQuestion",
      description:
        "Push a question out by a number of days. Deferring does not resolve it; the ledger still counts it as open.",
      schema: z.object({
        id: z.string().min(1),
        days: z.number().int().min(1).max(365).optional(),
      }),
    },
  );

export const questionsList = questionsListTool();
export const answerQuestion = answerQuestionTool();
export const deferQuestion = deferQuestionTool();

/** The same three, blind to every file but the ones the scope names. */
export const scopedQuestionTools = (ids: QuestionScope) => [
  questionsListTool(ids),
  answerQuestionTool(ids),
  deferQuestionTool(ids),
];

type RunnerMode = "auto" | "normal";

type StartRunOutcome =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly message: string };

type StartIngestRun = (
  paths: readonly string[],
  mode: RunnerMode,
) => Promise<StartRunOutcome>;

/** The app's runner lives above this package, so the app builds this tool and hands it in. */
export const startIngestRunTool = (start: StartIngestRun) =>
  guardedTool(
    async ({ paths, mode }) => {
      const outcome = await start(paths, mode ?? "auto");
      if (!outcome.ok) {
        return toolResult({ status: "error", message: outcome.message });
      }
      return toolResult({
        started: true,
        runId: outcome.runId,
        note: "The run works in the background; the Ingest page feed shows each step.",
      });
    },
    {
      name: "startIngestRun",
      description:
        "Start a background ingest run on the named statement files. The ingest agent prepares, posts and closes them; progress shows on the Ingest page. Refused while another run is live.",
      schema: z.object({
        paths: z
          .array(z.string().min(1))
          .min(1)
          .describe("Relative file paths as listFiles reports them"),
        mode: z
          .enum(["auto", "normal"])
          .optional()
          .describe(
            "auto finishes alone; normal parks open questions for the user",
          ),
      }),
    },
  );
