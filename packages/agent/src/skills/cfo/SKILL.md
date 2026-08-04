---
name: cfo
description: Reading and correcting a household double-entry ledger — what each read tool answers, how account direction and signed totals work, how a figure must be quoted, and the playbooks for fixing the books (creating and merging accounts, moving misplaced statement rows, adjustments). Use for any question about spending, income, balances, accounts, merchants, runway or net worth, and for any request to change, move, fix or clean up ledger data.
---

# CFO analysis

Every figure comes from the ledger. There is no estimating: if a number is not
in the briefing and not in a tool result, call a tool for it.

## Which tool answers what

- `getReport` — income, expenses and net over a date range, grouped by
  currency. Use it for "how much did I spend in July", never for "on what".
- `listTransactions` — the individual charges, newest first, filtered by
  account id, date range or a text match on the description. Use it for "on
  what", for one merchant, or to check a single charge.
- `listAccounts` — every leaf account with its current balance. Use it for
  "how much is in", for a card balance, and to learn an account id before
  filtering transactions by it.

## How the ledger works

- Double entry: every transaction debits one account and credits another.
  Direction comes from the account pair, never from a sign. A refund reduces
  expenses rather than adding income, so a month with a big refund shows lower
  expenses, not extra income.
- Account ids read `<currency>:<type>:<segments>` — `thb:expense:food:coffee`.
  The first segment is the currency, so an id already says which currency a
  figure is in.
- Assets and expenses are debit-positive; liabilities, income and equity are
  credit-positive. A positive balance on a credit-card liability is money owed,
  not money held.
- Parent accounts report zero. Only leaves carry figures.
- Totals are keyed by currency and never added across currencies.

## Quoting figures

- Thai baht is the primary currency, written `฿1,234,567`. USD holdings stay in
  dollars and are reported alongside, never converted.
- Say which window a figure covers. A month-to-date total is not a monthly
  total, and a ledger that ends mid-month is not a quiet month.
- When a figure comes from one account, name the account.
- One number, one claim: never restate the same figure two ways.

## Correcting the ledger

- New account: `matchAccounts` first, `createAccount` only when nothing
  matches. Missing parents are created with it, so `thb:liability:credit-card:x`
  needs no scaffolding.
- Misplaced statement: fix in place. `listTransactions` on the wrong account
  shows each row's `source_file`; for every row from that statement, post the
  corrected pair with `addTransaction` (same date, amount, description), then
  `deleteTransaction` the misplaced row. Re-read both balances and quote them.
  Work in batches when there are many rows and report the count moved so far.
- Duplicate rows: `mergeTransactions` voids the mirror into its twin. Duplicate
  accounts: `mergeAccounts` moves the whole history and deletes the source —
  which is also the required first step before `deleteAccount` on anything
  non-empty.
- `recategorizeTransactions` re-points an account's entire history. Right for
  "everything in X belongs in Y", wrong for one statement.
- `adjustBalance` posts a real row against `<currency>:equity:adjustments`
  with the reason recorded; `to` is the balance as `listAccounts` reports it.
  Use it to reconcile against a verified statement figure, never to hide a
  difference you have not explained.
- Re-ingest (`dropFile`, then `startIngestRun` when the app provides it) is the
  last resort, for an import that is itself unusable — wrong extraction,
  duplicated file — not for rows that merely sit in the wrong account.
- Every write answers with the `oled` command it ran. Repeat what changed in
  plain words, then the post-write figures you re-read.
