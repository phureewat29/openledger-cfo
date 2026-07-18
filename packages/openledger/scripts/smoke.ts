import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OledCommandEvent, OledError, Result } from "../src/index";
import { createOpenLedger, FILE_ID_PATTERN } from "../src/index";
import { textPdf } from "./pdf-fixture";

/** Throwaway by construction: main() wipes this directory before every run. */
const LEDGER_DIR = process.env.OLED_SMOKE_DIR ?? join(tmpdir(), "oled-smoke");

const CONFIG_PATH = join(LEDGER_DIR, "config.json");

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

const record = (name: string, ok: boolean, detail = ""): boolean => {
  checks.push({ name, ok, detail });
  return ok;
};

const describeError = (error: OledError): string =>
  `${error.kind}: ${error.message}`;

/** Asserts a Result succeeded, recording the CLI error verbatim when it did not. */
const expectOk = <T>(
  name: string,
  result: Result<T, OledError>,
): T | undefined => {
  if (!result.ok) {
    record(name, false, describeError(result.error));
    return undefined;
  }
  record(name, true);
  return result.value;
};

const expectEqual = (
  name: string,
  actual: unknown,
  expected: unknown,
): void => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  record(
    name,
    ok,
    ok
      ? ""
      : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
};

const expectIncludes = (name: string, actual: string, needle: string): void => {
  const ok = actual.includes(needle);
  record(name, ok, ok ? "" : `expected ${needle} in ${actual}`);
};

const expectErrorKind = <T>(
  name: string,
  result: Result<T, OledError>,
  kinds: OledError["kind"][],
): void => {
  if (result.ok) {
    record(name, false, "expected a failure, got success");
    return;
  }
  const ok = kinds.includes(result.error.kind);
  record(
    name,
    ok,
    ok ? "" : `expected ${kinds.join("|")}, got ${describeError(result.error)}`,
  );
};

const CHART = [
  {
    id: "thb:asset:bank:kbank",
    name: "KBank Savings",
    type: "asset" as const,
    subtype: "bank",
    bank_name: "Kasikornbank",
    account_number_masked: "****1234",
  },
  { id: "thb:expense:food", name: "Food & Dining", type: "expense" as const },
  { id: "thb:income:salary", name: "Salary", type: "income" as const },
  {
    id: "thb:equity:opening",
    name: "Opening Balance (THB)",
    type: "equity" as const,
  },
  {
    id: "thb:equity:conversion",
    name: "Currency Conversion (THB)",
    type: "equity" as const,
  },
  {
    id: "usd:asset:brokerage:cash",
    name: "Brokerage Cash",
    type: "asset" as const,
    subtype: "brokerage",
  },
  {
    id: "usd:equity:opening",
    name: "Opening Balance (USD)",
    type: "equity" as const,
  },
  {
    id: "usd:equity:conversion",
    name: "Currency Conversion (USD)",
    type: "equity" as const,
  },
];

const BATCH = [
  {
    date: "2026-01-01",
    description: "Opening balance",
    debit_account: "thb:asset:bank:kbank",
    credit_account: "thb:equity:opening",
    amount: 50_000,
  },
  {
    date: "2026-01-25",
    description: "January salary",
    debit_account: "thb:asset:bank:kbank",
    credit_account: "thb:income:salary",
    amount: 85_000,
  },
  {
    date: "2026-02-03",
    description: "Coffee",
    debit_account: "thb:expense:food",
    credit_account: "thb:asset:bank:kbank",
    amount: 320.5,
    raw_descriptor: "STARBUCKS SIAM PARAGON",
    merchant: { canonical_name: "Starbucks", alias: "STARBUCKS SIAM PARAGON" },
  },
  {
    date: "2026-02-10",
    description: "FX transfer THB to USD brokerage",
    linked: [
      {
        debit_account: "thb:equity:conversion",
        credit_account: "thb:asset:bank:kbank",
        amount: 35_000,
      },
      {
        debit_account: "usd:asset:brokerage:cash",
        credit_account: "usd:equity:conversion",
        amount: 1_000,
      },
    ],
  },
];

const CARD = "thb:liability:card:visa";

/** The second row creates the short-named placeholder the next batch looks like. */
const STATEMENT_ROWS = [
  {
    date: "2026-05-01",
    description: "Card coffee",
    debit_account: "thb:expense:food",
    credit_account: CARD,
    amount: 135,
    source_page: 1,
    row_index: 0,
  },
  {
    date: "2026-05-02",
    description: "Card lunch",
    debit_account: "thb:expense:fo0d",
    credit_account: CARD,
    amount: 65,
    source_page: 1,
    row_index: 1,
  },
];

/**
 * A second batch, so the file's cumulative counters have something to add up.
 * Both ids are one edit from that placeholder's name: the lookalike check
 * scores account names, which is why nothing here looks like "Food & Dining".
 */
const STATEMENT_TAIL = [
  {
    date: "2026-05-03",
    description: "Card dinner",
    debit_account: "thb:expense:fo0ds",
    credit_account: CARD,
    amount: 60,
    source_page: 2,
    row_index: 2,
  },
  {
    date: "2026-05-04",
    description: "Card taxi",
    debit_account: "thb:expense:fo0dz",
    credit_account: CARD,
    amount: 40,
    source_page: 2,
    row_index: 3,
  },
];

const CARD_CLOSING_BALANCE = 300;

const printTable = (): void => {
  const nameWidth = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) {
    const status = check.ok ? "PASS" : "FAIL";
    const detail = check.detail === "" ? "" : `  ${check.detail}`;
    process.stdout.write(
      `${status}  ${check.name.padEnd(nameWidth)}${detail}\n`,
    );
  }
  const failed = checks.filter((check) => !check.ok).length;
  process.stdout.write(
    `\n${String(checks.length - failed)}/${String(checks.length)} passed${failed === 0 ? "" : `, ${String(failed)} FAILED`}\n`,
  );
};

const main = async (): Promise<void> => {
  await rm(LEDGER_DIR, { recursive: true, force: true });

  const oled = createOpenLedger({ configPath: CONFIG_PATH });

  const init = expectOk(
    "config init",
    await oled.bootstrap.configInit({
      configPath: CONFIG_PATH,
      db: join(LEDGER_DIR, "ledger.db"),
      dataDir: join(LEDGER_DIR, "data"),
      cacheDir: join(LEDGER_DIR, "cache"),
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      userName: "Smoke Tester",
    }),
  );
  if (init) expectEqual("config init currency", init.displayCurrency, "THB");

  // --init refuses an existing config, which is how re-running stays safe.
  expectErrorKind(
    "config init refuses re-init",
    await oled.bootstrap.configInit({
      configPath: CONFIG_PATH,
      db: join(LEDGER_DIR, "ledger.db"),
      dataDir: join(LEDGER_DIR, "data"),
    }),
    ["invalid"],
  );

  const created = expectOk(
    "accounts create batch",
    await oled.bootstrap.accountsCreateBatch(CHART),
  );
  if (created) {
    // `--currency THB` already seeded thb:equity:opening, so one row is a duplicate.
    expectEqual("accounts create duplicates", created.summary.duplicates, 1);
    expectEqual("accounts create failed", created.summary.failed, 0);
  }

  const committed = expectOk(
    "ingest commit batch",
    await oled.bootstrap.ingestCommitBatch(BATCH),
  );
  if (committed) {
    // `posted` counts input rows; the linked row posts two legs.
    expectEqual("ingest posted rows", committed.summary.posted, 4);
    expectEqual(
      "ingest raised questions",
      committed.summary.raised_questions,
      0,
    );
    const linked = committed.rows.at(3);
    expectEqual("linked row has two legs", linked?.legs?.length, 2);
  }

  const status = expectOk("status", await oled.status());
  if (status) {
    expectEqual("status transaction count", status.counts?.transactions, 5);
    expectEqual("status open questions", status.questions?.open, 0);
    expectEqual("status net worth USD", status.net_worth?.assets.USD, 1000);
  }

  const report = expectOk(
    "report",
    await oled.report({ from: "2026-01-01", to: "2026-12-31" }),
  );
  if (report) {
    expectEqual("report income THB", report.income.THB, 85_000);
    expectEqual("report expenses THB", report.expenses.THB, 320.5);
    expectEqual("report net THB", report.net.THB, 84_679.5);
  }

  const all = expectOk(
    "transactions listAll",
    await oled.transactions.listAll(),
  );
  if (all) expectEqual("transactions listAll count", all.length, 5);

  const usd = expectOk(
    "transactions list --currency USD",
    await oled.transactions.list({ currency: "USD" }),
  );
  if (usd) expectEqual("USD ledger row count", usd.rows.length, 1);

  const tree = expectOk("accounts tree", await oled.accounts.tree());
  // One root per account type per currency ledger: thb/usd x asset, equity + thb income, expense.
  if (tree) expectEqual("accounts tree roots", tree.summary?.roots, 6);

  const merchants = expectOk("merchants list", await oled.merchants.list());
  if (merchants) {
    const linked = merchants.rows.some(
      (row) => row.canonical_name === "Starbucks",
    );
    record(
      "merchant linked by ingest",
      linked,
      linked ? "" : "Starbucks not in merchants list",
    );
  }

  const upserted = expectOk(
    "merchants upsert",
    await oled.bootstrap.merchantsUpsert({
      name: "Grab",
      alias: "GRAB*RIDE BKK",
      default_account: "thb:expense:food",
    }),
  );
  if (upserted) {
    expectEqual(
      "merchant default account",
      upserted.default_account_id,
      "thb:expense:food",
    );
  }

  const questions = expectOk("questions list", await oled.questions.list());
  if (questions) expectEqual("no open questions", questions.rows.length, 0);

  const dataDir = expectOk("config dataDir", await oled.config.dataDir());
  if (dataDir) {
    expectEqual("config dataDir path", dataDir, join(LEDGER_DIR, "data"));
  }

  await writeFile(join(LEDGER_DIR, "data", "statement.pdf"), textPdf(2));

  const discovered = expectOk("ingest list", await oled.ingest.list());
  if (discovered) {
    expectEqual("ingest list rows", discovered.rows.length, 1);
    expectEqual("ingest list status", discovered.rows.at(0)?.status, "new");
    expectEqual(
      "ingest list unregistered",
      discovered.rows.at(0)?.file_id,
      null,
    );
    expectEqual("ingest list summary new", discovered.summary?.new, 1);
  }

  const prepared = expectOk(
    "ingest prepare",
    await oled.ingest.prepare("statement.pdf"),
  );
  const fileId = prepared?.file_id ?? "";
  if (prepared) {
    record("prepare returns an sf id", FILE_ID_PATTERN.test(fileId), fileId);
    expectEqual("prepare route", prepared.kind, "text");
    expectEqual("prepare reader", prepared.source, "text-layer");
    expectEqual("prepare page count", prepared.page_count, 2);
    expectIncludes(
      "prepare reports its command",
      prepared.command,
      "oled ingest prepare statement.pdf",
    );
  }

  const document = expectOk(
    "ingest document",
    await oled.ingest.document(fileId),
  );
  if (document) {
    expectEqual("document page count", document.page_count, 2);
    expectEqual("document not truncated", document.truncated, false);
    record(
      "document opens on page 1",
      document.text.startsWith("--- page 1 ---"),
      document.text.slice(0, 40),
    );
  }

  expectErrorKind(
    "document refuses a path",
    await oled.ingest.document("statement.pdf"),
    ["invalid"],
  );
  expectErrorKind(
    "document not_found before a prepare",
    await oled.ingest.document("sf-00000000-0000-0000-0000-000000000000"),
    ["not_found"],
  );

  const statement = expectOk(
    "ingest commit --file",
    await oled.ingest.commit(STATEMENT_ROWS, { fileId }),
  );
  if (statement) {
    expectEqual("commit file status", statement.summary.file_status, "pending");
    expectEqual(
      "commit file transaction count",
      statement.summary.file_transaction_count,
      2,
    );
    expectEqual(
      "commit file open questions",
      statement.summary.file_open_question_count,
      0,
    );
    expectIncludes(
      "commit reports its command",
      statement.command,
      `oled ingest commit --file ${fileId}`,
    );
  }

  const tail = expectOk(
    "ingest commit second batch",
    await oled.ingest.commit(STATEMENT_TAIL, { fileId }),
  );
  if (tail) {
    expectEqual(
      "second batch adds to the file total",
      tail.summary.file_transaction_count,
      4,
    );
    expectEqual(
      "second batch raises both questions",
      tail.summary.file_open_question_count,
      2,
    );
  }

  const raised = expectOk(
    "questions list after commit",
    await oled.questions.list(),
  );
  const ids = raised?.rows.map((row) => row.id) ?? [];
  if (raised) expectEqual("commit raised two questions", ids.length, 2);

  const deferred = expectOk(
    "questions defer",
    await oled.questions.defer(ids.at(0) ?? "", { days: 3 }),
  );
  if (deferred) expectEqual("defer days", deferred.days, 3);

  const answered = expectOk(
    "questions answer --also",
    await oled.questions.answer(ids.at(1) ?? "", "merged the lookalikes", {
      also: [ids.at(0) ?? ""],
    }),
  );
  if (answered) {
    expectEqual("answer closes both ids", answered.rows.length, 2);
    expectEqual(
      "answer echoes its text",
      answered.rows.at(0)?.answer,
      "merged the lookalikes",
    );
    expectIncludes(
      "answer reports its command",
      answered.command,
      "oled questions answer",
    );
  }

  const drained = expectOk(
    "questions list after answering",
    await oled.questions.list({ includeDeferred: true }),
  );
  if (drained) expectEqual("question queue empty", drained.rows.length, 0);

  expectErrorKind(
    "answer refuses a bogus id",
    await oled.questions.answer("cn:nope", "x"),
    ["not_found"],
  );
  expectErrorKind(
    "defer refuses a bogus id",
    await oled.questions.defer("cn:nope"),
    ["not_found"],
  );

  expectErrorKind(
    "done refuses half a reconciliation",
    await oled.ingest.done(fileId, { account: CARD }),
    ["invalid"],
  );
  expectErrorKind(
    "done refuses a balance the ledger disagrees with",
    await oled.ingest.done(fileId, { account: CARD, closingBalance: 1 }),
    ["invalid"],
  );

  const closed = expectOk(
    "ingest done",
    await oled.ingest.done(fileId, {
      account: CARD,
      closingBalance: CARD_CLOSING_BALANCE,
    }),
  );
  if (closed) {
    expectEqual("done status", closed.status, "ingested");
    expectEqual(
      "done reconciled balance",
      closed.reconciliation?.balance,
      CARD_CLOSING_BALANCE,
    );
  }

  // Closing the file cleans its cache, so the extraction goes with it.
  expectErrorKind(
    "document is gone once the file closes",
    await oled.ingest.document(fileId),
    ["not_found"],
  );

  await writeFile(join(LEDGER_DIR, "data", "receipt.pdf"), textPdf(1));
  const receipt = expectOk(
    "ingest prepare a second file",
    await oled.ingest.prepare("receipt.pdf"),
  );
  const receiptId = receipt?.file_id ?? "";

  expectErrorKind(
    "fail refuses an empty note",
    await oled.ingest.fail(receiptId, "  "),
    ["invalid"],
  );
  const abandoned = expectOk(
    "ingest fail",
    await oled.ingest.fail(receiptId, "unreadable scan"),
  );
  if (abandoned) expectEqual("fail status", abandoned.status, "failed");

  const settled = expectOk(
    "ingest list after the pipeline",
    await oled.ingest.list(),
  );
  if (settled) {
    expectEqual("ingest list ingested", settled.summary?.ingested, 1);
    expectEqual("ingest list failed", settled.summary?.failed, 1);
    expectEqual("ingest list total", settled.summary?.total, 2);
  }

  await writeFile(join(LEDGER_DIR, "data", "dropped.pdf"), textPdf(1));
  const registered = expectOk(
    "ingest prepare the file to drop",
    await oled.ingest.prepare("dropped.pdf"),
  );
  const droppedId = registered?.file_id ?? "";

  const droppedRows = expectOk(
    "ingest commit against the file to drop",
    await oled.ingest.commit(
      [
        {
          date: "2026-06-01",
          description: "Row that leaves with its file",
          debit_account: "thb:expense:food",
          credit_account: "thb:asset:bank:kbank",
          amount: 12,
          source_page: 1,
          row_index: 0,
        },
      ],
      { fileId: droppedId },
    ),
  );
  if (droppedRows) {
    expectEqual("row posted against the file", droppedRows.summary.posted, 1);
  }

  expectErrorKind(
    "files drop refuses a path",
    await oled.files.drop("dropped.pdf"),
    ["invalid"],
  );
  expectErrorKind(
    "files drop refuses an unknown id",
    await oled.files.drop("sf-00000000-0000-0000-0000-000000000000"),
    ["not_found"],
  );

  const dropped = expectOk("files drop", await oled.files.drop(droppedId));
  if (dropped) {
    expectEqual("drop echoes the file id", dropped.file_id, droppedId);
    expectEqual(
      "drop cascades the file's rows",
      dropped.removed_transactions,
      1,
    );
    expectEqual("drop cascades no questions", dropped.removed_questions, 0);
    expectEqual("drop purges the cache", dropped.cache_removed.length, 1);
  }

  const orphaned = expectOk(
    "transactions after the drop",
    await oled.transactions.list({ query: "leaves with its file" }),
  );
  if (orphaned) {
    expectEqual(
      "the dropped file's rows went with it",
      orphaned.rows.length,
      0,
    );
  }

  // Nothing can reach the extraction once the row is gone.
  expectErrorKind(
    "document is gone once the file drops",
    await oled.ingest.document(droppedId),
    ["not_found"],
  );

  // Deregistered, not deleted: the statement is still on disk, unknown again.
  const deregistered = expectOk(
    "ingest list after the drop",
    await oled.ingest.list(),
  );
  if (deregistered) {
    const row = deregistered.rows.find(
      (file) => file.rel_path === "dropped.pdf",
    );
    expectEqual("the dropped file is unregistered", row?.file_id, null);
    expectEqual("the dropped file reads as new", row?.status, "new");
  }

  const events: OledCommandEvent[] = [];
  const logged = createOpenLedger({
    configPath: CONFIG_PATH,
    onCommand: (event) => events.push(event),
  });

  // Nothing at that path, so the run fails; the argv still reaches the log masked.
  await logged.ingest.prepare("no-such-statement.pdf", { password: "hunter2" });
  const started = events.at(0);
  const ended = events.at(1);
  expectEqual("command log records a start and an end", events.length, 2);
  expectEqual("command log pairs the two by id", started?.id, ended?.id);
  expectEqual("command log start phase", started?.phase, "start");
  expectEqual("command log carries the exit code", ended?.exitCode, 5);
  record(
    "command log times the run",
    (ended?.durationMs ?? -1) >= 0,
    String(ended?.durationMs),
  );

  const loggedArgv = started?.argv.join(" ") ?? "";
  expectIncludes("password is masked", loggedArgv, "--password •••");
  record(
    "password never reaches the log",
    !loggedArgv.includes("hunter2"),
    loggedArgv,
  );
  expectIncludes(
    "log carries the final argv",
    loggedArgv,
    "--json --no-color --config",
  );

  events.length = 0;
  const [slow, fast] = await Promise.all([
    logged.ingest.prepare("statement.pdf"),
    logged.ingest.list(),
  ]);
  record(
    "slow lane prepare",
    slow.ok,
    slow.ok ? "" : describeError(slow.error),
  );
  record("fast lane list", fast.ok, fast.ok ? "" : describeError(fast.error));
  const slowEnd = events.find(
    (event) => event.phase === "end" && event.argv.at(1) === "prepare",
  );
  const fastStart = events.find(
    (event) => event.phase === "start" && event.argv.at(1) === "list",
  );
  record(
    "a list does not queue behind a prepare",
    (fastStart?.ts ?? Number.POSITIVE_INFINITY) <=
      (slowEnd?.ts ?? Number.NEGATIVE_INFINITY),
    `list started ${String(fastStart?.ts)}, prepare ended ${String(slowEnd?.ts)}`,
  );

  const bogus = createOpenLedger({
    configPath: join(LEDGER_DIR, "missing", "config.json"),
  });
  // Deliberately not status(): status exits 0 against a missing config and would
  // read the developer's default ~/.oled ledger instead of failing.
  expectErrorKind(
    "not_configured on missing config",
    await bogus.accounts.list(),
    ["not_configured"],
  );

  expectErrorKind(
    "unknown account rejected",
    await oled.transactions.add({
      debit_account: "thb:expense:doesnotexist",
      credit_account: "thb:asset:bank:kbank",
      amount: 10,
      date: "2026-03-01",
      description: "bogus",
    }),
    ["not_found", "invalid"],
  );

  expectErrorKind(
    "cross-currency row rejected before spawn",
    await oled.transactions.add({
      debit_account: "usd:asset:brokerage:cash",
      credit_account: "thb:asset:bank:kbank",
      amount: 10,
    }),
    ["invalid"],
  );

  // A row naming an unopened ledger fails its row and exits 7, not the whole batch.
  expectErrorKind(
    "partial batch surfaces failures",
    await oled.bootstrap.ingestCommitBatch([
      {
        date: "2026-04-01",
        description: "good",
        debit_account: "thb:expense:food",
        credit_account: "thb:asset:bank:kbank",
        amount: 5,
      },
      {
        date: "2026-04-02",
        description: "unopened ledger",
        debit_account: "zzz:expense:food",
        credit_account: "zzz:asset:bank",
        amount: 5,
      },
    ]),
    ["partial"],
  );

  // --- The correction verbs the CFO agent drives, on probe-* accounts. ---

  const createdA = expectOk(
    "accounts.create single via flags",
    await oled.accounts.create({
      id: "thb:asset:bank:probe-a",
      name: "Probe Bank A",
      type: "asset",
    }),
  );
  expectEqual("create reports the id", createdA?.id, "thb:asset:bank:probe-a");
  expectIncludes(
    "create carries its command",
    createdA?.command ?? "",
    "accounts create --id thb:asset:bank:probe-a",
  );
  expectErrorKind(
    "duplicate create refused",
    await oled.accounts.create({
      id: "thb:asset:bank:probe-a",
      name: "Probe Bank A",
      type: "asset",
    }),
    ["invalid"],
  );
  expectErrorKind(
    "malformed account id refused before spawn",
    await oled.accounts.create({ id: "probe", name: "Probe", type: "asset" }),
    ["invalid"],
  );

  await oled.accounts.create({
    id: "thb:asset:bank:probe-b",
    name: "Probe Bank B",
    type: "asset",
  });
  await oled.accounts.create({
    id: "thb:expense:probe-x",
    name: "Probe Spend",
    type: "expense",
  });

  const matches = expectOk(
    "accounts.match finds by name",
    await oled.accounts.match("Probe Bank"),
  );
  record(
    "match returns the named account",
    matches?.rows.some((row) => row.account.id === "thb:asset:bank:probe-a") ??
      false,
    "probe-a missing from matches",
  );
  expectErrorKind(
    "empty match query refused before spawn",
    await oled.accounts.match("  "),
    ["invalid"],
  );

  const renamed = expectOk(
    "accounts.update renames",
    await oled.accounts.update("thb:asset:bank:probe-a", {
      name: "Probe Bank A2",
    }),
  );
  expectEqual("update reports the id", renamed?.id, "thb:asset:bank:probe-a");
  expectErrorKind(
    "empty update patch refused before spawn",
    await oled.accounts.update("thb:asset:bank:probe-a", {}),
    ["invalid"],
  );

  const addOf = async (
    amount: number,
    date: string,
    description: string,
    credit = "thb:asset:bank:probe-a",
  ) =>
    oled.transactions.add({
      debit_account: "thb:expense:probe-x",
      credit_account: credit,
      amount,
      date,
      description,
    });

  const coffee = await addOf(100, "2026-05-01", "probe coffee");
  expectIncludes(
    "transactions.add carries its command",
    coffee.ok ? coffee.value.command : "",
    "transactions add",
  );
  const twinKeep = await addOf(42, "2026-05-02", "probe twin");
  const twinVoid = await addOf(42, "2026-05-02", "probe twin");
  await addOf(70, "2026-05-03", "probe dinner", "thb:asset:bank:probe-b");

  const txIdOf = (result: Awaited<ReturnType<typeof addOf>>): string =>
    result.ok ? result.value.transaction_id : "tx:missing";

  const touched = expectOk(
    "transactions.update fixes the description",
    await oled.transactions.update(txIdOf(coffee), {
      description: "probe espresso",
    }),
  );
  expectEqual("tx update confirms", touched?.updated, true);

  const removedRow = expectOk(
    "transactions.delete removes a row",
    await oled.transactions.delete(txIdOf(coffee)),
  );
  expectEqual("tx delete confirms", removedRow?.deleted, true);

  const voided = expectOk(
    "transactions.merge voids the mirror",
    await oled.transactions.merge({
      from: txIdOf(twinVoid),
      to: txIdOf(twinKeep),
    }),
  );
  expectEqual("tx merge reports voided", voided?.voided, true);
  expectErrorKind(
    "self tx merge refused before spawn",
    await oled.transactions.merge({
      from: txIdOf(twinKeep),
      to: txIdOf(twinKeep),
    }),
    ["invalid"],
  );

  const repointed = expectOk(
    "transactions.recategorize re-points the whole account",
    await oled.transactions.recategorize({
      from: "thb:asset:bank:probe-b",
      to: "thb:asset:bank:probe-a",
    }),
  );
  expectEqual("recategorize moved the one row", repointed?.affected, 1);
  expectErrorKind(
    "cross-currency recategorize refused before spawn",
    await oled.transactions.recategorize({
      from: "usd:asset:brokerage:cash",
      to: "thb:asset:bank:probe-a",
    }),
    ["invalid"],
  );

  const adjusted = expectOk(
    "accounts.adjust posts to the target",
    await oled.accounts.adjust("thb:asset:bank:probe-a", {
      to: 500,
      reason: "probe reconcile",
    }),
  );
  record(
    "adjust answers with a posted transaction",
    (adjusted?.transaction_id ?? "").startsWith("tx:"),
    adjusted?.transaction_id ?? "no transaction id",
  );
  const adjustRow = await oled.transactions.list({
    account: "thb:asset:bank:probe-a",
    limit: 1,
  });
  const counterAccounts = adjustRow.ok
    ? [
        adjustRow.value.rows[0]?.debit_account_id,
        adjustRow.value.rows[0]?.credit_account_id,
      ]
    : [];
  record(
    "adjust posts against equity:adjustments",
    counterAccounts.includes("thb:equity:adjustments"),
    counterAccounts.join(" / "),
  );
  const probeBalances = await oled.accounts.list();
  expectEqual(
    "adjusted balance equals the target",
    probeBalances.ok
      ? probeBalances.value.rows.find(
          (row) => row.id === "thb:asset:bank:probe-a",
        )?.balance
      : undefined,
    500,
  );
  expectErrorKind(
    "blank adjust reason refused before spawn",
    await oled.accounts.adjust("thb:asset:bank:probe-a", {
      to: 1,
      reason: "  ",
    }),
    ["invalid"],
  );

  expectOk(
    "accounts.merge folds one account into another",
    await oled.accounts.merge({
      from: "thb:asset:bank:probe-b",
      to: "thb:asset:bank:probe-a",
    }),
  );
  const afterMerge = await oled.accounts.list();
  expectEqual(
    "merged-from account is gone",
    afterMerge.ok
      ? afterMerge.value.rows.some((row) => row.id === "thb:asset:bank:probe-b")
      : true,
    false,
  );
  expectErrorKind(
    "cross-currency account merge refused before spawn",
    await oled.accounts.merge({
      from: "usd:asset:brokerage:cash",
      to: "thb:asset:bank:probe-a",
    }),
    ["invalid"],
  );

  await oled.accounts.create({
    id: "thb:asset:bank:probe-d",
    name: "Probe D",
    type: "asset",
  });
  const removedAccount = expectOk(
    "accounts.delete removes an empty account",
    await oled.accounts.delete("thb:asset:bank:probe-d"),
  );
  expectEqual("account delete confirms", removedAccount?.deleted, true);
  // The ledger's own guard: history means merge first, never a cascade.
  expectErrorKind(
    "delete of a non-empty account refused",
    await oled.accounts.delete("thb:expense:probe-x"),
    ["invalid"],
  );
};

await main();
printTable();

if (checks.some((check) => !check.ok)) process.exitCode = 1;
