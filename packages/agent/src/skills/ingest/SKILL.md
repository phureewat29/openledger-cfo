---
name: ingest
description: A local double-entry harness driven through the `oled` cli. Use for anything about the ledger, bank or credit-card statements, net worth, spending, accounts, transactions, or merchants.
compatibility: Requires Node.js >= 18 and the oled CLI (npm install -g @aquartier/openledger)
---

<!--
  Body vendored verbatim from @aquartier/openledger v0.23.0
  (skills/openledger/SKILL.md). Only the frontmatter `name` differs, because the
  Agent Skills spec requires it to match this directory.

  To refresh: copy the body of that file out of the installed CLI
  (`npm ls -g @aquartier/openledger` locates it) and re-apply the rename.
-->

# OpenLedger

`oled` is a deterministic CLI over a local, double-entry ledger; you supply the intelligence. The CLI is the manual: `oled --help` lists the commands and the output contract, `oled <noun> --help` gives each command's behavior, flow, and flags, and every error carries a code and a message, often a `hint`. When you do not understand something, ask the CLI: never invent flags, subcommands, or ids.

Always pass `--json`. List output ends with a `{"type":"summary"}` row — page with `--offset` while it says `has_more`. Money totals are keyed by currency; never add two currencies together.

## Setup

`oled --version` prints a version when installed. To install: check `node --version` >= 18, then `npm install -g @aquartier/openledger`. First run: `oled config --init --json` unless `oled status --json` shows `"configured":true`; commands that touch the ledger exit 3 until then, and `--init` refuses a setup that already exists (exit 6) — change settings with plain flags, e.g. `oled config --ocr-base-url <url> --json`. Every other command accepts `--config <path>` to run against a different config file, a separate ledger; `oled config <path> --json` reads or writes that file directly. Statements go in the `dataDir` from `oled config --json`, as PDFs or as photos/scans (PNG/JPEG/WebP); `oled open` opens it.

## Loop

One statement, five steps: **discover** with `oled ingest list --json` (this walks the data dir; `oled files list --json` only browses what is already registered, so an empty list there means nothing has been ingested yet, not that there is nothing to do) · **prepare** it with `oled ingest prepare <rel_path> --json` and read the `document` it returns · **commit** the rows with `oled ingest commit --file <sf-id> --json`, reading `oled ingest commit --help` first for the item shape and the debit/credit directions (a card payment debits the card liability and credits a bank asset; a refund reverses the purchase's two accounts) · **resolve** whatever `oled questions list --json` raised · **close** with `oled ingest done <sf-id> --json`. A file stays `pending` until `done` runs, and pending means unfinished. When the statement prints a closing balance, close with `oled ingest done <sf-id> --account <card-or-bank-id> --closing-balance <n> --json`: it refuses to close unless that account's ledger balance equals the statement's figure, which is how a misread amount gets caught. An unfiltered `oled transactions list --json` grows with every batch; the commit summary's counters and `oled ingest done <sf-id> --closing-balance <n>` already say where the file stands. A first statement needs its opening balance posted as a row against `<currency>:equity:opening` for that to tie. A row left in `<currency>:expense:uncategorized` raises a question you must answer later — book it to a real account now. Deferring a question does not resolve it; `file_open_question_count` hides deferred ones, `oled status --json` still counts them.

## Commands

Start with `oled status --json` — its `files.new` counts statements waiting in the data dir. Descriptions live in `oled --help`. commands: `oled doctor --json` · `oled setup --force` · `oled config --json` · `oled ingest list --json` (find new statements) · `oled files list --json` (browse ingested) · `oled transactions list --json` · `oled accounts tree --json` · `oled merchants list --json` · `oled questions list --json` · `oled questions answer <id> --answer <text> --json` (`--also <ids>` closes siblings in the same pass) · `oled report --from <date> --to <date> --json` · `oled notes list --json` · `oled datasets --json` · `oled open`. A locked PDF exits 4: re-run `oled ingest prepare <path> --password <password> --json`. A long statement's rows outgrow a command line: write the NDJSON to a file and commit the whole statement with one `--input`, or in batches no smaller than a page, with `oled ingest commit --input <file> --json`. Never drip-feed a few rows per call — `row_index` + `--file` make a re-commit an idempotent `duplicate:true` no-op, so large batches are safe.
