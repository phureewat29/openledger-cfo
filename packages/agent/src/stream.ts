import type { UIMessageChunk } from "ai";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { attemptAsync, isPlainObject, mapValues } from "es-toolkit";

import { SECRET_MASK } from "@openledger-cfo/openledger";

import { asRecord, asString, parseJson, textOf } from "./untyped";

/** A LangGraph v2 stream event. Kept structural so we never import graph internals. */
export interface LangGraphEvent {
  event: string;
  name?: string;
  run_id?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

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

/** Where text that never parsed as JSON rides, whole. */
const RAW_FIELD = "_raw";

const parseInput = (args: string): unknown => {
  if (!args) return {};
  const parsed = parseJson(args);
  return parsed === undefined ? { [RAW_FIELD]: args } : parsed;
};

/** A model may wrap its arguments, so a secret field is masked at any depth. */
const maskFields = (value: unknown, secrets: readonly string[]): unknown => {
  if (Array.isArray(value))
    return value.map((item) => maskFields(item, secrets));
  if (!isPlainObject(value)) return value;
  return mapValues(asRecord(value), (item, field) =>
    secrets.includes(field) || field === RAW_FIELD
      ? SECRET_MASK
      : maskFields(item, secrets),
  );
};

/**
 * Only an object's fields can be masked one by one. Anything else is opaque,
 * and so is the unparsed text under `_raw`: a secret may sit anywhere in it.
 */
const maskSecrets = (input: unknown, secrets: readonly string[]): unknown =>
  isPlainObject(input)
    ? maskFields(input, secrets)
    : { [RAW_FIELD]: SECRET_MASK };

type SecretInputs = Readonly<Record<string, readonly string[]>>;

export interface BridgeOptions {
  /** Include subagent token output in the visible transcript. Default false. */
  includeSubagents?: boolean;
  /** Tool names to keep out of the transcript, results included. */
  hiddenTools?: readonly string[];
  /** Tool input fields, by tool name, whose values must never be echoed back. */
  secretInputs?: SecretInputs;
  /**
   * Given the answer just streamed, what the user might ask next. Called once
   * the last token is out, and it holds the stream open while it runs, so it
   * owns its own deadline. Returning nothing is the normal way to decline.
   */
  followUps?: (answer: string) => Promise<readonly string[]>;
}

const NONE: readonly string[] = [];

/**
 * One `toUIChunks` run: the options it was given, read-only, beside the
 * bookkeeping its handlers write as events arrive.
 */
interface StreamState {
  readonly hiddenTools: readonly string[];
  readonly secretInputs: SecretInputs;
  stepOpen: boolean;
  textId: string | null;
  reasoningId: string | null;
  /** Per model turn, keyed by the chunk index the provider streams. */
  pending: Map<number, ToolCallEntry>;
  /** Tool call ids we chose to hide, so their results stay hidden too. */
  hidden: Set<string>;
  /** Every visible token of this run, for whatever reads the finished answer. */
  answer: string;
}

const initialState = (
  hiddenTools: readonly string[],
  secretInputs: SecretInputs,
): StreamState => ({
  hiddenTools,
  secretInputs,
  stepOpen: false,
  textId: null,
  reasoningId: null,
  pending: new Map(),
  hidden: new Set(),
  answer: "",
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

/** Closes any prior step and opens a new one. */
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
  state.answer += text;

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

  if (state.hiddenTools.includes(entry.name)) {
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
): Generator<UIMessageChunk> {
  if (!part.args) return;
  entry.args += part.args;
  // A secret would reach the transcript one delta at a time.
  if (state.hidden.has(entry.id) || state.secretInputs[entry.name]) return;
  yield {
    type: "tool-input-delta",
    toolCallId: entry.id,
    inputTextDelta: part.args,
  };
}

function* toolInputDeltas(
  chunk: Record<string, unknown>,
  state: StreamState,
): Generator<UIMessageChunk> {
  for (const part of toolCallChunksOf(chunk)) {
    const entry = yield* openToolCall(part, state);
    if (!entry) continue;
    yield* toolInputDelta(part, entry, state);
  }
}

/** Fans one model chunk out to its deltas. */
function* modelDeltas(
  event: LangGraphEvent,
  state: StreamState,
): Generator<UIMessageChunk> {
  const chunk = unwrap(event.data?.chunk);
  yield* reasoningDelta(chunk, event, state);
  yield* textDelta(chunk, event, state);
  yield* toolInputDeltas(chunk, state);
}

function* toolInputAvailable(
  entry: ToolCallEntry,
  state: StreamState,
): Generator<UIMessageChunk> {
  if (state.hidden.has(entry.id)) return;
  const secrets = state.secretInputs[entry.name];
  const input = parseInput(entry.args);
  yield {
    type: "tool-input-available",
    toolCallId: entry.id,
    toolName: entry.name,
    input: secrets ? maskSecrets(input, secrets) : input,
  };
}

/** Closes the turn and flushes its finished tool calls. */
function* modelEnd(state: StreamState): Generator<UIMessageChunk> {
  yield* closeReasoning(state);
  yield* closeText(state);
  for (const entry of state.pending.values()) {
    yield* toolInputAvailable(entry, state);
  }
}

/** Reports a tool's result, unless its call was hidden. */
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

type Handler = (
  event: LangGraphEvent,
  state: StreamState,
) => Generator<UIMessageChunk>;

/** The graph events the transcript reads; every other one passes unseen. */
const HANDLERS = {
  on_chat_model_start: (_event, state) => startStep(state),
  on_chat_model_stream: modelDeltas,
  on_chat_model_end: (_event, state) => modelEnd(state),
  on_tool_end: toolOutput,
} satisfies Record<string, Handler>;

const isHandled = (name: string): name is keyof typeof HANDLERS =>
  Object.hasOwn(HANDLERS, name);

/**
 * Rides out on the answer's own message as a data part, which is what keeps the
 * chips attached to the turn that earned them once the transcript scrolls on.
 * A run that said nothing has nothing to follow up, and a thrown or empty
 * result is silence rather than an error: the answer is already delivered and
 * garnish must not take it down.
 */
async function* followUpData(
  state: StreamState,
  followUps: BridgeOptions["followUps"],
): AsyncGenerator<UIMessageChunk> {
  if (followUps === undefined || state.answer.length === 0) return;

  const [, suggestions] = await attemptAsync(() => followUps(state.answer));
  if (suggestions === null || suggestions.length === 0) return;
  yield { type: "data-suggestions", data: [...suggestions] };
}

/**
 * Converts LangGraph v2 events into AI SDK UI message chunks.
 *
 * Emits `start`/`finish` itself, so the output is byte-compatible with what
 * the SDK's own `toUIMessageStream` produces from a `streamText` run.
 */
async function* toUIChunks(
  events: AsyncIterable<LangGraphEvent>,
  options: BridgeOptions = {},
): AsyncGenerator<UIMessageChunk> {
  const {
    includeSubagents = false,
    hiddenTools = NONE,
    secretInputs = {},
    followUps,
  } = options;

  const state = initialState(hiddenTools, secretInputs);

  yield { type: "start" };

  for await (const event of events) {
    if (!includeSubagents && nsDepth(event) > 0) continue;
    if (isHandled(event.event)) yield* HANDLERS[event.event](event, state);
  }

  yield* closeStep(state);
  yield* followUpData(state, followUps);
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
