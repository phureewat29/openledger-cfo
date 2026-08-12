# Corgi CFO

This repo is a worked example of building on [OpenLedger](https://www.npmjs.com/package/@aquartier/openledger)'s `oled` CLI: one app, a fleet of packages around it, and a committed demo dataset that proves the whole path from bank statement to balance sheet.

The app is Corgi CFO, a terminal-styled personal finance app. It reads a local, double-entry ledger and tells you where your money went, what you own, and what to do next.

## What's inside

- **apps/cfo** — the app: four pages and a chat pane, dark and monospace throughout.
- **packages/openledger** — a typed connector over the `oled` CLI: two exec lanes, masked secrets, `Result` values instead of thrown errors.
- **packages/db** — the control plane: drizzle and postgres tables for budgets, goals, insight state, reminders.
- **packages/api** — thin tRPC: ledger reads pass through, control-plane tables get CRUD, plus a ring buffer of recent CLI calls.
- **packages/agent** — a deepagents runtime: a CFO advisor and an ingest operator, served through OpenRouter.
- **packages/demo** — the fixed demo dataset, its loader, and the checks that prove it loaded right.
- **packages/ui** — dark design tokens, the `Pane` primitive, Geist Mono.

## Prerequisites

- Node 22.21 or later, pnpm 10.19 or later
- Postgres reachable at `POSTGRES_URL`. Docker is the easy way: default is user and password `postgres`, host `127.0.0.1:5432`, database `openledger_fleet`.
- The `oled` CLI on your `PATH`, version 0.23 or later: `npm install -g @aquartier/openledger`

## Quickstart

```bash
pnpm install
cp .env.example .env
pnpm bootstrap   # pushes the control-plane schema, then loads the demo ledger
pnpm dev         # http://localhost:3001
```

`pnpm bootstrap` resets the local ledger in `.oled/` to the demo dataset. That directory is gitignored, and separate from your own `~/.oled`, if you have one. To provision the ledger without the data — config, chart of accounts, merchants, no transactions — run `pnpm oled:init` instead of the load.

## The four pages

- **Everything** (`/`) — vitals, cash flow, the action queue, and the latest transactions. Are you okay right now.
- **Accounts** (`/accounts`) — every balance: banks, cards, loans, investments, assets against liabilities.
- **Plan** (`/plan`) — budgets, goals, and reminders, measured against the ledger.
- **Ingest** (`/ingest`) — the statement pipeline: files, a document viewer, open questions, and a live log of every `oled` command.

A status line at the bottom of the screen echoes the last `oled` command, its exit code, and how long it took.

## The AI layer

Two agents, both built with deepagents and OpenRouter (`packages/agent`):

- **CFO** lives in the chat pane on the right of every page. It answers from a ledger-computed briefing plus read tools, and it can correct the books on request: create or rename accounts, merge duplicates, move or delete transactions, post reconciling adjustments, and drop a misingested statement for re-import. Every write shows the exact `oled` command it ran. Statement ingest itself stays with the ingest agent — the CFO can only press its start button.
- **Ingest** is a background worker, not a chat. Drop a statement on the Ingest page and click Ingest: one agent run works the whole queue — prepare, read the extracted text, post rows, answer the questions the ledger raises, close each file — while a live feed shows every step, the counts, and the extracted text. Leave the page and come back; the run keeps going and the rail pulses while it does.

A locked statement asks for its password on its own file row, before any run. The password goes straight to `oled ingest prepare`, which unlocks and extracts on the spot; the connector masks it everywhere a command appears: feed, logs, status line.

Without `OPENROUTER_API_KEY` set, the chat pane and the Ingest button turn off. The file rows keep their manual actions, and every other pane is still computed from the ledger by rules, so nothing waits on a key.

## Architecture

Two server surfaces, split by lifetime. Reads and control-plane CRUD go through tRPC. The two operations that outlive a request — the chat stream and the ingest run — go through plain route handlers (`/api/chat`, `/api/ingest/*`) backed by one in-process runner, because they need streaming and abort semantics tRPC does not model. Every `oled` call spawns the CLI at request time on two serialized lanes; nothing caches in front of it.

## The demo data

`packages/demo/data/life.json` is a fixed, committed dataset: a Bangkok household, 24 months, 7,719 rows, Thai baht as the primary currency with a US-dollar investing sleeve. It draws no random numbers and reads no clock, so loading it always produces the same ledger.

Every instrument keeps a ledger of its own, counted in the instrument rather than in money: `apl` holds Apple shares, `eth` holds thousandths of a coin. Cost stays in the baht or dollar account and quantity stays in the unit head, so a price is never written down. It is the ratio between the two legs of the trade that moved both. `oled status` prints a line per head, where `assets.APL 60.53` means 60.53 shares, not 60.53 dollars. THB and USD are the money columns; the app treats every other head as a quantity and keeps it out of the totals.

`pnpm demo` loads the dataset, derives budgets, goals, and reminders from it into postgres, and checks the result: dozens of structural and post-load checks, from "employment payslips reconcile" to "no negative asset balances." `pnpm demo:generate -- --variant 2` authors a new variant and proves it the same way before writing it to disk.

## Repo layout

```
apps/
  cfo/           the app
packages/
  openledger/    typed connector over the oled CLI
  db/            drizzle schema and client
  api/           tRPC routers
  agent/         the cfo and ingest agents
  demo/          the fixed dataset, loader, verify checks
  ui/            dark tokens, Pane, Geist Mono
tooling/         eslint, prettier, typescript configs
```

## License

AGPL-3.0.
