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

  let stepOpen = false;
  let textId: string | null = null;
  let reasoningId: string | null = null;
  /** Per model turn, keyed by the chunk index the provider streams. */
  let pending = new Map<number, { id: string; name: string; args: string }>();
  /** Tool call ids we chose to hide, so their results stay hidden too. */
  const hidden = new Set<string>();

  const closeText = function* (): Generator<UIMessageChunk> {
    if (textId === null) return;
    yield { type: "text-end", id: textId };
    textId = null;
  };
  const closeReasoning = function* (): Generator<UIMessageChunk> {
    if (reasoningId === null) return;
    yield { type: "reasoning-end", id: reasoningId };
    reasoningId = null;
  };
  const closeStep = function* (): Generator<UIMessageChunk> {
    yield* closeReasoning();
    yield* closeText();
    if (!stepOpen) return;
    yield { type: "finish-step" };
    stepOpen = false;
  };

  yield { type: "start" };

  for await (const event of events) {
    if (!includeSubagents && nsDepth(event) > 0) continue;

    switch (event.event) {
      case "on_chat_model_start": {
        yield* closeStep();
        yield { type: "start-step" };
        stepOpen = true;
        pending = new Map();
        break;
      }

      case "on_chat_model_stream": {
        const chunk = unwrap(event.data?.chunk);

        const reasoning = reasoningOf(chunk);
        if (reasoning) {
          if (reasoningId === null) {
            reasoningId = `r-${event.run_id ?? "0"}`;
            yield { type: "reasoning-start", id: reasoningId };
          }
          yield { type: "reasoning-delta", id: reasoningId, delta: reasoning };
        }

        const text = textOf(chunk.content);
        if (text) {
          yield* closeReasoning();
          if (textId === null) {
            textId = `t-${event.run_id ?? "0"}`;
            yield { type: "text-start", id: textId };
          }
          yield { type: "text-delta", id: textId, delta: text };
        }

        for (const part of toolCallChunksOf(chunk)) {
          let entry = pending.get(part.index);
          if (!entry) {
            // The opening chunk is the only one carrying id and name.
            if (!part.id && !part.name) continue;
            entry = {
              id: part.id || `call-${String(part.index)}`,
              name: part.name,
              args: "",
            };
            pending.set(part.index, entry);
            if (hiddenTools.includes(entry.name)) {
              hidden.add(entry.id);
            } else {
              yield {
                type: "tool-input-start",
                toolCallId: entry.id,
                toolName: entry.name,
              };
            }
          }
          if (!part.args) continue;
          entry.args += part.args;
          // A secret would reach the transcript one delta at a time.
          if (hidden.has(entry.id) || secretInputs[entry.name]) continue;
          yield {
            type: "tool-input-delta",
            toolCallId: entry.id,
            inputTextDelta: part.args,
          };
        }
        break;
      }

      case "on_chat_model_end": {
        yield* closeReasoning();
        yield* closeText();
        for (const entry of pending.values()) {
          if (hidden.has(entry.id)) continue;
          const secrets = secretInputs[entry.name];
          const input = parseInput(entry.args);
          yield {
            type: "tool-input-available",
            toolCallId: entry.id,
            toolName: entry.name,
            input: secrets ? maskSecrets(input, secrets) : input,
          };
        }
        break;
      }

      case "on_tool_end": {
        const message = unwrap(event.data?.output);
        const toolCallId = asString(message.tool_call_id);
        if (!toolCallId || hidden.has(toolCallId)) break;

        if (message.status === "error") {
          yield {
            type: "tool-output-error",
            toolCallId,
            errorText: textOf(message.content),
          };
          break;
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
        break;
      }

      default:
        break;
    }
  }

  yield* closeStep();
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
