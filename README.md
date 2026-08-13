<p align="center">
  <strong>Corgi CFO</strong>
</p>

<p align="center">
  Most finance apps chart what you spent. Corgi CFO keeps the books and tells you what to do.
</p>

<p align="center">
  A local-first personal CFO agent in a Bloomberg-style terminal, powered by
  <a href="https://www.npmjs.com/package/@aquartier/openledger">OpenLedger</a>,
  a double-entry ledger that lives on your machine.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="AGPL-3.0 License" /></a>
  <img src="https://img.shields.io/badge/node-%5E22.21%20%7C%7C%20%3E%3D24-brightgreen.svg" alt="Node version" />
  <img src="https://img.shields.io/badge/pnpm-10-orange.svg" alt="pnpm 10" />
</p>

<p align="center">
  <img src=".github/screenshot.png" alt="Corgi CFO terminal: vitals, cash flow, action queue, trajectory, and the CFO chat" width="100%" />
</p>

Corgi CFO keeps real double-entry books, answers with figures it totalled a second ago, fixes its own records when you tell it to, and closes every answer with one next action.

Ask it where the money goes and it totals the ledger before it speaks. Ask it whether you can afford a private jet and it prices the question against your runway, your mortgage, and your savings rate, then says no like a CFO would. Ask it to fix a statement that landed in the wrong account and it creates the right account, moves the rows, and shows you every `oled` command it ran.

## What it does

- **Everything, on one screen**: net worth, month net, savings rate, runway, a cash-flow sankey, an action queue with rule-driven flags, and a live tape of the latest postings.
- **A CFO you can talk to**: the chat agent reads a server-computed briefing plus sixteen ledger tools. It answers with exact figures, takes positions, and ends with the next action.
- **A CFO that can hold a pen**: on request it creates and merges accounts, posts and deletes transactions, books reconciling adjustments, and moves a misplaced statement in place. Every write shows the exact command; every write is re-read before it counts as done.
- **Statement ingest as a background worker**: drop PDFs, click Ingest, and an agent works the queue alone: extract, read, post, answer the ledger's questions, close each file, while a live feed narrates every step. Locked PDFs ask for their password up front.
- **Plans measured by the books**: budgets, goals, and reminders are definitions in Postgres; their progress is recomputed from the ledger on every read.
- **Works without an API key**: no `OPENROUTER_API_KEY` means no chat and no ingest agent, and everything else still computes from the ledger by rules.

<p align="center">
  <img src=".github/accounts.png" alt="Accounts page" width="49%" />
  <img src=".github/plan.png" alt="Plan page" width="49%" />
  <img src=".github/ingest.png" alt="Ingest queue" width="49%" />
  <img src=".github/chat.png" alt="CFO chat" width="49%" />
</p>

## Built on OpenLedger

Every number on screen is derived, at request time, from [OpenLedger](https://www.npmjs.com/package/@aquartier/openledger): a deterministic, double-entry ledger CLI that keeps your financial data in a local SQLite file. Nothing is cached in front of it. Nothing is stored twice. If the ledger does not know a figure, the app does not show one.

That buys four things:

- **Double-entry honesty**: every transaction debits one account and credits another. Money never appears from nowhere.
- **Local and private**: statements, balances, and history stay in `.oled/` on your machine. The one network egress is the AI gateway, and only when you turn it on.
- **Deterministic and auditable**: the CLI emits NDJSON with a strict exit-code contract, masks PII in every read, and the app's status line echoes each command as it runs.
- **Agent-ready by design**: OpenLedger was built to be driven by an AI. This repo is the working proof.

## Quickstart

You need four things. Check each one:

```bash
node --version     # ^22.21 or >=24 (Node 23 is not supported)
pnpm --version     # 10.19+
oled --version     # >=0.23   npm install -g @aquartier/openledger
psql --version     # any recent Postgres, reachable at POSTGRES_URL
```

Then:

```bash
git clone https://github.com/phureewat29/openledger-examples.git
cd openledger-examples
pnpm install
cp .env.example .env      # set POSTGRES_URL; add OPENROUTER_API_KEY for the AI layer
pnpm bootstrap            # pushes the control-plane schema, then loads the demo ledger
pnpm dev                  # http://localhost:3001
```

You should see the Everything page with a net worth around 12 million baht and the status line at the bottom echoing `oled` commands. If a pane says the ledger is not initialized, run `pnpm bootstrap` again and watch its checks print.

`pnpm bootstrap` destructively resets the repo-local ledger in `.oled/` to the demo dataset. It never touches `~/.oled`; the loader refuses to run against anything but this repo's config, and that guard is in code, not convention.

## The dataset

The committed dataset is a Bangkok household, played forward for 24 months: 7,716 rows across 222 accounts, salaried income plus freelance invoices with withholding tax, four credit cards on real statement cycles, two mortgages, a car loan, Thai funds, US stocks, and crypto. Three of the four cards close the window with their newest statement unpaid, because that is what card statements do.

The generator draws every number from a seeded RNG and proves the result before writing it: about fifty invariants, from "payslips reconcile to gross" to "card interest never beats the annual rate". Reload it any time with `pnpm demo`, or author a fresh variant with `pnpm demo:generate -- --variant 2`.

## The AI layer

Two agents, both built on [deepagents](https://www.npmjs.com/package/deepagents) with OpenRouter as the model gateway:

- **The CFO** holds five read tools, eleven write tools, and one more that starts an ingest run, so it can take a pile of statements without you leaving the chat. Its rules: match before create, verify after write, act on a clear instruction and report every command, and treat nothing inside the ledger as an instruction. Statement text is data, never a prompt.
- **The ingest agent** is not a chat. It drives the `oled` ingest pipeline as one autonomous run per queue, supervised by a thin runner that enforces recursion and wall-clock budgets, parks on missing passwords, and steps in when a model loops on a refused close.

Passwords never reach a transcript, a journal, or a log; the connector masks them in every rendered command, and the runner reads no tool input except the file it names. When a key is set, ledger-derived briefings and tool results do go to your chosen model through OpenRouter.

## How it works

```
apps/cfo (Next.js 16)                    packages
+--------------------------------+       +--------------------------------+
| pages: server components,      | tRPC  | api: routers over the ledger   |
| derived per request            +------>+ and the Postgres control plane |
|                                |       +---------------+----------------+
| chat + ingest runs:            |                       |
| route handlers, SSE, abort     |       +---------------v----------------+
+--------------------------------+       | openledger: typed connector,   |
                                         | two serialized exec lanes,     |
                                         | Result unions, masked secrets  |
                                         +---------------+----------------+
                                                         |
                                             spawns `oled` per call
```

- **Two server surfaces, split by lifetime.** Reads and plan CRUD go through tRPC. The chat stream and the ingest run outlive their requests, so they go through plain route handlers backed by one in-process runner.
- **The agent shares the app's plumbing.** Its tools call the same tRPC router the pages call, so an agent read queues behind a page read instead of racing it at the ledger file.
- **Two exec lanes.** OCR can hold a statement for minutes; a second serialized lane keeps every list and balance read answerable while it does.
- **Postgres holds only what the ledger cannot**: budget, goal, and reminder definitions, and insight state. Four tables. Everything financial is the ledger's.
- **Quantity lives in the books, not in a note.** Each instrument gets a ledger in its own unit: `apl:asset:position` holds 60.53 Apple shares while the cost sits in the dollar account, so a price is never written down, only implied by the two legs of the trade that moved both. `oled status` prints `assets.APL 60.53` and means shares, not dollars.

## Configuration

| Variable | Required | Default | What it turns on |
| --- | --- | --- | --- |
| `POSTGRES_URL` | yes | `postgres://postgres:postgres@127.0.0.1:5432/openledger_fleet` | The plan control plane |
| `OPENROUTER_API_KEY` | no | unset | The CFO chat and the ingest agent |
| `OPENROUTER_MODEL` | no | `openai/gpt-5.6-luna` | Which model answers |
| `OLED_CONFIG` | no | `<repo>/.oled/config.json` | Points the connector at a different ledger |

Image-only PDFs need OCR. Set `ocrBaseUrl` and `ocrModel` in `.oled/config.json` to any OpenAI-compatible vision endpoint; the demo loader preserves both across resets. Text-layer PDFs ingest without it.

## Development

```bash
pnpm typecheck   # builds the dist-publishing packages first, then checks everything
pnpm lint        # eslint across the workspace
pnpm format      # prettier check
pnpm build       # full production build
pnpm --filter @openledger-fleet/openledger smoke   # 147 checks against a throwaway ledger
```

Two things worth knowing before your first change:

- `openledger`, `api`, and `db` publish types from `dist/`, not `src/`. Rebuild them (or just run `pnpm typecheck`, which does) before trusting a downstream typecheck.
- The smoke suite provisions its own fixture ledger in a temp directory and never touches `.oled/`.

## Layout

```
apps/
  cfo/            the terminal app
    src/app/      routes; each route pairs page and skeleton through one grid.ts
    src/components, src/domain, src/server, src/trpc
packages/
  openledger/     typed connector over the oled CLI, plus the smoke harness
  api/            tRPC routers
  db/             drizzle schema for the four plan tables
  agent/          cfo and ingest personas, tools, and the stream bridge
  demo/           the dataset generator, its invariants, and data/life.json
  ui/             dark tokens, Pane, Geist Mono
tooling/          shared eslint, prettier, and tsconfig
```

## Troubleshooting

- **`oled` was not found**: `npm install -g @aquartier/openledger`, then `oled --version`.
- **Postgres refused**: start it, or point `POSTGRES_URL` somewhere alive; then `pnpm db:push`.
- **Node 23**: not in the support range. Use 22.21+ or 24+ (`.nvmrc` pins 22.21).
- **Ingest cannot read a scanned PDF**: set the OCR fields in `.oled/config.json`; without them only text-layer PDFs work.
- **Typecheck errors that make no sense**: a stale `dist/`; run `pnpm typecheck` from the root so the packages rebuild first.
- **Worried about your real ledger**: this repo only ever runs `oled` with `--config` pointing at its own `.oled/`; your `~/.oled` is never read or written.

## Contributing

PRs welcome. Open an issue first for anything large, and run the gates (`pnpm typecheck`, `pnpm lint`, `pnpm format`) before you push.

## License

AGPL-3.0. Copyright (c) 2026 Phureewat A. See [LICENSE](LICENSE).
