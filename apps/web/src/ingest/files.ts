import { countBy, groupBy, orderBy, partition, sumBy } from "es-toolkit";

import type {
  IngestFileRow,
  IngestFileSummary,
  QuestionRow,
  TransactionRow,
} from "@openledger-cfo/openledger";

export type IngestFile = IngestFileRow;
export type IngestCounts = IngestFileSummary;
export type IngestQuestion = QuestionRow;

/** Anything but a closed file is still work the agent can pick up. */
export const WORKABLE = new Set<IngestFile["status"]>([
  "new",
  "pending",
  "failed",
  "unreadable",
]);

/** Closed either way — and closing deletes the extraction cache with it. */
export const SETTLED = new Set<IngestFile["status"]>(["ingested", "failed"]);

/** What `oled ingest prepare` can read: a statement PDF or a photo of one. */
const UPLOAD_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
]);

/** The file picker's `accept` list, spelled from the set the route enforces. */
export const UPLOAD_ACCEPT = [...UPLOAD_EXTENSIONS]
  .map((extension) => `.${extension}`)
  .join(",");

export const UPLOAD_TYPE_ERROR = "Only PDF, PNG and JPG files can be ingested.";

/** The dropzone's idle label; the loading skeleton must print the same. */
export const UPLOAD_HINT = "Drop files, or click — PDF, PNG, JPG";

/**
 * A name's extension, lowercased, when the ledger can read it. A leading dot
 * marks a hidden file, not an extension.
 */
export const uploadExtensionOf = (name: string): string | undefined => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const extension = name.slice(dot + 1).toLowerCase();
  return UPLOAD_EXTENSIONS.has(extension) ? extension : undefined;
};

/** Windows opens these as devices whatever extension follows them. */
const DEVICE_NAME = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * One path segment in the ledger's data dir, stripped of anything a shell or a walk
 * reads as structure. A device name moves aside on every OS, so Windows can read the dir.
 */
export const safeUploadName = (raw: string): string | undefined => {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const name = base
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._ -]/g, "-")
    .trim();
  if (name.length === 0 || name.startsWith(".")) return undefined;
  // Windows reads the device off the part before the first dot, trailing spaces dropped.
  const head = name.split(".", 1)[0]?.trimEnd() ?? "";
  return DEVICE_NAME.test(head) ? `_${name}` : name;
};

/**
 * Windows reads either separator and ignores case, so one file answers to
 * several spellings there. Elsewhere a backslash is part of a filename.
 */
export const pathKeyOf = (path: string, platform: NodeJS.Platform): string =>
  platform === "win32" ? path.replaceAll("\\", "/").toLowerCase() : path;

/** Encrypted and untouched: nothing can read it until the operator unlocks it. */
export const isLocked = (row: IngestFile): boolean =>
  row.encrypted && row.status === "new";

const isIngestable = (row: IngestFile): boolean =>
  WORKABLE.has(row.status) && !isLocked(row);

/**
 * How a row leaves the queue. A registered file is dropped first, or its rows
 * and questions outlive their statement; taking back an ingested one is a ledger correction.
 */
export const REMOVAL: Readonly<
  Record<IngestFile["status"], "unlink" | "drop" | "refuse">
> = {
  new: "unlink",
  unreadable: "unlink",
  pending: "drop",
  failed: "drop",
  ingested: "refuse",
};

const isRemovable = (row: IngestFile): boolean =>
  REMOVAL[row.status] !== "refuse";

/** Posted, still open, and with nothing left for the operator to answer. */
const isCloseable = (row: IngestFile, openQuestions: number): boolean =>
  row.status === "pending" && openQuestions === 0;

/**
 * `failed` is the CLI's word for a file that will not be posted. The operator
 * did not watch it fail — they discarded it, and the list says so.
 */
export const STATUS_LABEL: Record<IngestFile["status"], string> = {
  new: "new",
  pending: "pending",
  ingested: "ingested",
  failed: "discarded",
  unreadable: "unreadable",
};

/** Questions carry the file they were raised from, so the join is client-side. */
export const openQuestionsByFile = (
  questions: readonly IngestQuestion[],
): Readonly<Record<string, number>> =>
  countBy(
    questions.flatMap((question) =>
      question.file_id === null ? [] : [question.file_id],
    ),
    (fileId) => fileId,
  );

export const openCountOf = (
  openQuestions: Readonly<Record<string, number>>,
  row: IngestFile,
): number => (row.file_id === null ? 0 : (openQuestions[row.file_id] ?? 0));

export interface FileImpact {
  readonly account: string;
  readonly name: string | null;
  readonly currency: string;
  readonly debits: number;
  readonly credits: number;
  readonly legs: number;
}

/**
 * What a statement did to the books, account by account: every leg the file's
 * rows put somewhere, folded into debit and credit totals per account.
 */
export const fileImpactOf = (rows: readonly TransactionRow[]): FileImpact[] => {
  const legs = rows.flatMap((row) => [
    {
      account: row.debit_account_id,
      name: row.debit_account_name,
      currency: row.currency,
      side: "debit" as const,
      amount: row.amount,
    },
    {
      account: row.credit_account_id,
      name: row.credit_account_name,
      currency: row.currency,
      side: "credit" as const,
      amount: row.amount,
    },
  ]);

  const impacts = Object.values(groupBy(legs, (leg) => leg.account)).flatMap(
    (group): FileImpact[] => {
      const first = group[0];
      if (first === undefined) return [];
      const [debits, credits] = partition(group, (leg) => leg.side === "debit");
      return [
        {
          account: first.account,
          name: group.find((leg) => leg.name !== null)?.name ?? null,
          currency: first.currency,
          debits: sumBy(debits, (leg) => leg.amount),
          credits: sumBy(credits, (leg) => leg.amount),
          legs: group.length,
        },
      ];
    },
  );

  return orderBy(
    impacts,
    [(one) => Math.max(one.debits, one.credits)],
    ["desc"],
  );
};

export type FileActionKind = "ingest" | "delete" | "done";

interface FileAction {
  readonly kind: FileActionKind;
  /** The rows this action can actually work on, which is what its count says. */
  readonly targets: readonly IngestFile[];
}

/** In the bar's order; each claims only the rows it applies to, so a mixed pick offers every action with work. */
const SELECTION_ACTIONS: readonly {
  readonly kind: FileActionKind;
  readonly applies: (row: IngestFile, openQuestions: number) => boolean;
}[] = [
  { kind: "ingest", applies: (row) => isIngestable(row) },
  { kind: "done", applies: isCloseable },
  { kind: "delete", applies: (row) => isRemovable(row) },
];

/**
 * Nothing selected, nothing offered: running the whole queue is Select all
 * then Ingest, one verb with one meaning instead of a second button.
 */
export const actionsFor = (
  rows: readonly IngestFile[],
  selected: ReadonlySet<string>,
  openQuestions: Readonly<Record<string, number>>,
): FileAction[] => {
  const picked = rows.filter((row) => selected.has(row.rel_path));

  return SELECTION_ACTIONS.flatMap(({ kind, applies }) => {
    const targets = picked.filter((row) =>
      applies(row, openCountOf(openQuestions, row)),
    );
    return targets.length === 0 ? [] : [{ kind, targets }];
  });
};
