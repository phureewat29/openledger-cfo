/**
 * Live check: one small turn per agent kind against the real ledger.
 *
 * Reproduces what `createAgent().stream()` does, with a tap on the raw events
 * so the run can assert that the skill actually loaded — a skill that fails to
 * load is silent, and the agent answers plausibly without it.
 *
 * Run with: pnpm -F @openledger-cfo/agent probe
 */
import type { UIMessage, UIMessageChunk } from "ai";

import { readGateway } from "@openledger-cfo/api";

import type { GatewayConfig } from "../src/model";
import type { AgentKind } from "../src/registry";
import type { LangGraphEvent } from "../src/stream";
import { createAgent } from "../src/index";
import { AGENTS } from "../src/registry";
import { toUIMessageStreamResponse } from "../src/stream";

const BUDGET_MS = 120_000;

const ask = (text: string): UIMessage[] => [
  { id: "probe-1", role: "user", parts: [{ type: "text", text }] },
];

const readSse = async (response: Response): Promise<UIMessageChunk[]> => {
  const chunks: UIMessageChunk[] = [];
  const reader = response.body
    ?.pipeThrough(new TextDecoderStream())
    .getReader();
  if (!reader) return chunks;

  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") continue;
      chunks.push(JSON.parse(payload) as UIMessageChunk);
    }
  }
  return chunks;
};

interface Run {
  chunks: UIMessageChunk[];
  skills: { name?: string }[];
  text: string;
  tools: { name: string; command?: string }[];
}

const runAgent = async (
  kind: AgentKind,
  prompt: string,
  gateway: GatewayConfig,
): Promise<Run> => {
  const agent = createAgent(kind, { gateway });
  const spec = AGENTS[kind];
  let skills: { name?: string }[] = [];

  const tapped = async function* (): AsyncGenerator<LangGraphEvent> {
    const signal = AbortSignal.timeout(BUDGET_MS);
    for await (const event of agent.events(ask(prompt), signal)) {
      if (
        event.name === "SkillsMiddleware.before_agent" &&
        event.event === "on_chain_end"
      ) {
        const output = event.data?.output as
          | { skillsMetadata?: { name?: string }[] }
          | undefined;
        skills = output?.skillsMetadata ?? [];
      }
      yield event;
    }
  };

  const chunks = await readSse(
    toUIMessageStreamResponse(tapped(), {
      hiddenTools: spec.hiddenTools,
      secretInputs: spec.secretInputs,
    }),
  );

  const named = new Map<string, string>();
  const tools: { name: string; command?: string }[] = [];
  let text = "";

  for (const chunk of chunks) {
    if (chunk.type === "text-delta") text += chunk.delta;
    if (chunk.type === "tool-input-available") {
      named.set(chunk.toolCallId, chunk.toolName);
    }
    if (chunk.type === "tool-output-available") {
      const output = chunk.output as { command?: string } | undefined;
      tools.push({
        name: named.get(chunk.toolCallId) ?? "?",
        command: output?.command,
      });
    }
  }

  return { chunks, skills, text, tools };
};

let failures = 0;

const assert = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
};

const gateway = await readGateway();
if (gateway === undefined) {
  console.error(
    "AI gateway not configured — save base URL, API key, and model in the app settings first.",
  );
  process.exit(1);
}

console.log(`model: ${gateway.model}\n`);

console.log("=== cfo ===");
const cfo = await runAgent(
  "cfo",
  "Between 2026-07-01 and 2026-07-31, what were my total income and expenses? One sentence.",
  gateway,
);
console.log(`  reply: ${cfo.text.replace(/\s+/g, " ").trim()}`);
console.log(
  `  tools: ${cfo.tools.map((t) => `${t.name} (${t.command ?? "no command"})`).join(", ")}`,
);
console.log(
  `  skills: ${cfo.skills.map((s) => s.name ?? "?").join(", ") || "(none)"}`,
);
assert("text streamed", cfo.text.trim().length > 0);
assert(
  "at least one tool ran",
  cfo.tools.length > 0,
  `${cfo.tools.length} calls`,
);
assert("skill loaded", cfo.skills.length > 0);
assert(
  "read tool carries a command",
  cfo.tools.some((t) => t.command?.startsWith("oled ") === true),
);
assert(
  "built-in tools hidden",
  !cfo.chunks.some(
    (chunk) =>
      "toolName" in chunk && AGENTS.cfo.hiddenTools.includes(chunk.toolName),
  ),
);

console.log("\n=== ingest ===");
const ingest = await runAgent(
  "ingest",
  "What is waiting in the ingest queue right now? Just report the queue, do not prepare or commit anything.",
  gateway,
);
console.log(`  reply: ${ingest.text.replace(/\s+/g, " ").trim()}`);
console.log(
  `  tools: ${ingest.tools.map((t) => `${t.name} (${t.command ?? "no command"})`).join(", ")}`,
);
console.log(
  `  skills: ${ingest.skills.map((s) => s.name ?? "?").join(", ") || "(none)"}`,
);
assert("text streamed", ingest.text.trim().length > 0);
assert("skill loaded", ingest.skills.length > 0);
const listed = ingest.tools.find((t) => t.name === "ingestList");
assert("ingestList ran", listed !== undefined);
assert(
  "ingestList artifact carries its command",
  listed?.command?.startsWith("oled ingest list") === true,
  listed?.command ?? "",
);

console.log(
  `\n${failures === 0 ? "all checks passed" : `${String(failures)} check(s) failed`}`,
);
process.exit(failures === 0 ? 0 : 1);
