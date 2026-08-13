import type { UIMessageChunk } from "ai";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

/** A LangGraph v2 stream event. Kept structural so we never import graph internals. */
export interface LangGraphEvent {
  event: string;
  name?: string;
  run_id?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Masks a secret the same way the connector masks it in a command line. */
const MASK = "•••";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * LangChain objects arrive as class instances in-process but as
 * `{ lc, type, id, kwargs }` once serialized. Read through both.
 */
export const unwrap = (value: unknown): Record<string, unknown> => {
  const record = asRecord(value);
  return record.kwargs === undefined ? record : asRecord(record.kwargs);
};

/** Depth 0 is the root graph; subagents nest under `parent|child` namespaces. */
export const nsDepth = (event: LangGraphEvent): number =>
  asString(event.metadata?.checkpoint_ns).split("|").length - 1;

/** Pulls plain text out of string content or a content-block array. */
export const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(asRecord)
    .filter((part) => part.type === "text")
    .map((part) => asString(part.text))
    .join("");
};

/** Anthropic-style thinking blocks and OpenAI-style reasoning both land here. */
const reasoningOf = (chunk: Record<string, unknown>): string => {
  const direct = asRecord(chunk.additional_kwargs).reasoning_content;
  if (typeof direct === "string") return direct;
  const { content } = chunk;
  if (!Array.isArray(content)) return "";
  return content
    .map(asRecord)
    .filter((part) => part.type === "thinking" || part.type === "reasoning")
    .map((part) => asString(part.thinking) || asString(part.text))
    .join("");
};

interface ToolCallChunk {
  index: number;
  id: string;
  name: string;
  args: string;
}

/** Providers stream a call's id and name once, then its arguments in pieces. */
const toolCallChunksOf = (chunk: Record<string, unknown>): ToolCallChunk[] => {
  const parts = chunk.tool_call_chunks;
  if (!Array.isArray(parts)) return [];
  return parts.map(asRecord).map((part) => ({
    index: typeof part.index === "number" ? part.index : 0,
    id: asString(part.id),
    name: asString(part.name),
    args: asString(part.args),
  }));
};

/** A tool call as accumulated so far from one or more `ToolCallChunk`s. */
interface ToolCallEntry {
  id: string;
  name: string;
  args: string;
}

const parseInput = (args: string): unknown => {
  if (!args) return {};
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return { _raw: args };
  }
};

const maskSecrets = (input: unknown, secrets: readonly string[]): unknown => {
  const record = asRecord(input);
  const masked = secrets
    .filter((field) => record[field] !== undefined)
    .map((field) => [field, MASK] as const);
  return { ...record, ...Object.fromEntries(masked) };
};

export interface BridgeOptions {
  /** Include subagent token output in the visible transcript. Default false. */
  includeSubagents?: boolean;
  /** Tool names to keep out of the transcript, results included. */
  hiddenTools?: readonly string[];
  /** Tool input fields, by tool name, whose values must never be echoed back. */
  secretInputs?: Readonly<Record<string, readonly string[]>>;
}

const NONE: readonly string[] = [];

/** Mutable bookkeeping for one `toUIChunks` run, threaded through its handlers. */
interface StreamState {
  stepOpen: boolean;
  textId: string | null;
  reasoningId: string | null;
  /** Per model turn, keyed by the chunk index the provider streams. */
  pending: Map<number, ToolCallEntry>;
  /** Tool call ids we chose to hide, so their results stay hidden too. */
  hidden: Set<string>;
}

const initialState = (): StreamState => ({
  stepOpen: false,
  textId: null,
  reasoningId: null,
  pending: new Map(),
  hidden: new Set(),
});

function* closeText(state: StreamState): Generator<UIMessageChunk> {
  if (state.textId === null) return;
  yield { type: "text-end", id: state.textId };
  state.textId = null;
}

function* closeReasoning(state: StreamState): Generator<UIMessageChunk> {
  if (state.reasoningId === null) return;
  yield { type: "reasoning-end", id: state.reasoningId };
  state.reasoningId = null;
}

function* closeStep(state: StreamState): Generator<UIMessageChunk> {
  yield* closeReasoning(state);
  yield* closeText(state);
  if (!state.stepOpen) return;
  yield { type: "finish-step" };
  state.stepOpen = false;
}

/** Handles `on_chat_model_start`: closes any prior step and opens a new one. */
function* startStep(state: StreamState): Generator<UIMessageChunk> {
  yield* closeStep(state);
  yield { type: "start-step" };
  state.stepOpen = true;
  state.pending = new Map();
}

function* reasoningDelta(
  chunk: Record<string, unknown>,
  event: LangGraphEvent,
  state: StreamState,
): Generator<UIMessageChunk> {
  const reasoning = reasoningOf(chunk);
  if (!reasoning) return;

  const opening = state.reasoningId === null;
  const id = state.reasoningId ?? `r-${event.run_id ?? "0"}`;
  state.reasoningId = id;
  if (opening) yield { type: "reasoning-start", id };
  yield { type: "reasoning-delta", id, delta: reasoning };
}

function* textDelta(
  chunk: Record<string, unknown>,
  event: LangGraphEvent,
  state: StreamState,
): Generator<UIMessageChunk> {
  const text = textOf(chunk.content);
  if (!text) return;
  yield* closeReasoning(state);

  const opening = state.textId === null;
  const id = state.textId ?? `t-${event.run_id ?? "0"}`;
  state.textId = id;
  if (opening) yield { type: "text-start", id };
  yield { type: "text-delta", id, delta: text };
}

/** Gets this chunk index's pending entry, opening one on its first piece. */
function* openToolCall(
  part: ToolCallChunk,
  state: StreamState,
  hiddenTools: readonly string[],
): Generator<UIMessageChunk, ToolCallEntry | null> {
  const existing = state.pending.get(part.index);
  if (existing) return existing;

  // The opening chunk is the only one carrying id and name.
  if (!part.id && !part.name) return null;
  const entry: ToolCallEntry = {
    id: part.id || `call-${String(part.index)}`,
    name: part.name,
    args: "",
  };
  state.pending.set(part.index, entry);

  if (hiddenTools.includes(entry.name)) {
    state.hidden.add(entry.id);
    return entry;
  }
  yield {
    type: "tool-input-start",
    toolCallId: entry.id,
    toolName: entry.name,
  };
  return entry;
}

function* toolInputDelta(
  part: ToolCallChunk,
  entry: ToolCallEntry,
  state: StreamState,
  secretInputs: Readonly<Record<string, readonly string[]>>,
): Generator<UIMessageChunk> {
  if (!part.args) return;
  entry.args += part.args;
  // A secret would reach the transcript one delta at a time.
  if (state.hidden.has(entry.id) || secretInputs[entry.name]) return;
  yield {
    type: "tool-input-delta",
    toolCallId: entry.id,
    inputTextDelta: part.args,
  };
}

function* toolInputDeltas(
  chunk: Record<string, unknown>,
  state: StreamState,
  hiddenTools: readonly string[],
  secretInputs: Readonly<Record<string, readonly string[]>>,
): Generator<UIMessageChunk> {
  for (const part of toolCallChunksOf(chunk)) {
    const entry = yield* openToolCall(part, state, hiddenTools);
    if (!entry) continue;
    yield* toolInputDelta(part, entry, state, secretInputs);
  }
}

/** Handles `on_chat_model_stream`: fans one chunk out to its deltas. */
function* modelDeltas(
  event: LangGraphEvent,
  state: StreamState,
  hiddenTools: readonly string[],
  secretInputs: Readonly<Record<string, readonly string[]>>,
): Generator<UIMessageChunk> {
  const chunk = unwrap(event.data?.chunk);
  yield* reasoningDelta(chunk, event, state);
  yield* textDelta(chunk, event, state);
  yield* toolInputDeltas(chunk, state, hiddenTools, secretInputs);
}

function* toolInputAvailable(
  entry: ToolCallEntry,
  state: StreamState,
  secretInputs: Readonly<Record<string, readonly string[]>>,
): Generator<UIMessageChunk> {
  if (state.hidden.has(entry.id)) return;
  const secrets = secretInputs[entry.name];
  const input = parseInput(entry.args);
  yield {
    type: "tool-input-available",
    toolCallId: entry.id,
    toolName: entry.name,
    input: secrets ? maskSecrets(input, secrets) : input,
  };
}

/** Handles `on_chat_model_end`: closes the turn and flushes finished tool calls. */
function* modelEnd(
  state: StreamState,
  secretInputs: Readonly<Record<string, readonly string[]>>,
): Generator<UIMessageChunk> {
  yield* closeReasoning(state);
  yield* closeText(state);
  for (const entry of state.pending.values()) {
    yield* toolInputAvailable(entry, state, secretInputs);
  }
}

/** Handles `on_tool_end`: reports a result, unless its call was hidden. */
function* toolOutput(
  event: LangGraphEvent,
  state: StreamState,
): Generator<UIMessageChunk> {
  const message = unwrap(event.data?.output);
  const toolCallId = asString(message.tool_call_id);
  if (!toolCallId || state.hidden.has(toolCallId)) return;

  if (message.status === "error") {
    yield {
      type: "tool-output-error",
      toolCallId,
      errorText: textOf(message.content),
    };
    return;
  }

  // The structured object lives on `artifact` when the tool declares
  // responseFormat: "content_and_artifact"; otherwise content is JSON text.
  yield {
    type: "tool-output-available",
    toolCallId,
    output:
      message.artifact === undefined
        ? parseInput(textOf(message.content))
        : message.artifact,
  };
}

/**
 * Converts LangGraph v2 events into AI SDK UI message chunks.
 *
 * Emits `start`/`finish` itself, so the output is byte-compatible with what
 * `streamText().toUIMessageStreamResponse()` produces.
 */
async function* toUIChunks(
  events: AsyncIterable<LangGraphEvent>,
  options: BridgeOptions = {},
): AsyncGenerator<UIMessageChunk> {
  const {
    includeSubagents = false,
    hiddenTools = NONE,
    secretInputs = {},
  } = options;

  const state = initialState();

  yield { type: "start" };

  for await (const event of events) {
    if (!includeSubagents && nsDepth(event) > 0) continue;

    switch (event.event) {
      case "on_chat_model_start": {
        yield* startStep(state);
        break;
      }

      case "on_chat_model_stream": {
        yield* modelDeltas(event, state, hiddenTools, secretInputs);
        break;
      }

      case "on_chat_model_end": {
        yield* modelEnd(state, secretInputs);
        break;
      }

      case "on_tool_end": {
        yield* toolOutput(event, state);
        break;
      }

      default:
        break;
    }
  }

  yield* closeStep(state);
  yield { type: "finish" };
}

/** Wraps the bridge in the Response shape a route hands back to `useChat`. */
export function toUIMessageStreamResponse(
  events: AsyncIterable<LangGraphEvent>,
  options: BridgeOptions = {},
): Response {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        for await (const chunk of toUIChunks(events, options))
          writer.write(chunk);
      },
      onError: (error) =>
        error instanceof Error ? error.message : "Agent failed",
    }),
  });
}
