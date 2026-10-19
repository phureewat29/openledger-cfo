import type { UIMessage, UIMessageChunk } from "ai";
import { AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
} from "ai";
import { describe, expect, it, vi } from "vitest";

import type { BridgeOptions, LangGraphEvent } from "./stream";
import { toUIMessageStreamResponse } from "./stream";

const SECRET = "hunter2";

/** What `streamEvents` hands over once a value has crossed a serializer. */
const serialized = (kwargs: Record<string, unknown>) => ({
  lc: 1,
  type: "constructor",
  id: ["langchain_core", "messages", "AIMessageChunk"],
  kwargs,
});

const modelStream = (chunk: unknown, metadata?: Record<string, unknown>) => ({
  event: "on_chat_model_stream",
  run_id: "turn-1",
  data: { chunk },
  metadata,
});

/**
 * One turn that thinks, answers in a class instance and a serialized chunk,
 * calls a secret-bearing tool, a hidden tool and a failing one, then answers
 * again. A subagent's token sits in the middle, one namespace down.
 */
const TURN: LangGraphEvent[] = [
  { event: "on_chat_model_start", run_id: "turn-1" },
  modelStream({
    content: "",
    additional_kwargs: { reasoning_content: "Reading the queue." },
  }),
  modelStream(new AIMessageChunk({ content: "One file " })),
  modelStream(serialized({ content: [{ type: "text", text: "is locked." }] })),
  modelStream(
    { content: "subagent aside" },
    { checkpoint_ns: "tools:1|task:2" },
  ),
  modelStream({
    content: "",
    tool_call_chunks: [
      {
        index: 0,
        id: "call-prepare",
        name: "ingestPrepare",
        args: '{"pathOrId":"2026-01.pdf",',
      },
      { index: 1, id: "call-ls", name: "ls", args: '{"path":"/"}' },
      { index: 2, id: "call-list", name: "ingestList", args: "{}" },
    ],
  }),
  modelStream({
    content: "",
    tool_call_chunks: [{ index: 0, args: `"password":"${SECRET}"}` }],
  }),
  { event: "on_chat_model_end", run_id: "turn-1" },
  {
    event: "on_tool_end",
    data: {
      output: new ToolMessage({
        tool_call_id: "call-prepare",
        content: "input required",
        artifact: { ok: false, reason: "input-required" },
      }),
    },
  },
  {
    event: "on_tool_end",
    data: { output: serialized({ tool_call_id: "call-ls", content: "[]" }) },
  },
  {
    event: "on_tool_end",
    data: {
      output: serialized({
        tool_call_id: "call-list",
        status: "error",
        content: "ledger busy",
      }),
    },
  },
  { event: "on_chat_model_start", run_id: "turn-2" },
  { ...modelStream({ content: "Done." }), run_id: "turn-2" },
  { event: "on_chat_model_end", run_id: "turn-2" },
];

const OPTIONS: BridgeOptions = {
  hiddenTools: ["ls"],
  secretInputs: { ingestPrepare: ["password"] },
};

/** Hands recorded events over a microtask apart, the way a live graph does. */
async function* replay(
  events: readonly LangGraphEvent[],
): AsyncGenerator<LangGraphEvent> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

type Parsed =
  | { success: true; value: UIMessageChunk }
  | { success: false; error: unknown };

/**
 * Reads the body back exactly as `useChat`'s default transport does: the SSE
 * parser validates every chunk against the SDK's own schema, and the message
 * reader folds the chunks into the parts a client would render.
 */
const receive = async (
  response: Response,
): Promise<{ wire: string; message: UIMessage | undefined }> => {
  const wire = await response.text();
  const chunks = parseJsonEventStream({
    stream: new Blob([wire]).stream(),
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream<Parsed, UIMessageChunk>({
      transform(result, controller) {
        if (!result.success) throw result.error;
        controller.enqueue(result.value);
      },
    }),
  );

  let message: UIMessage | undefined;
  for await (const state of readUIMessageStream({ stream: chunks })) {
    message = state;
  }
  return { wire, message };
};

const bridge = (options: BridgeOptions = OPTIONS) =>
  receive(toUIMessageStreamResponse(replay(TURN), options));

describe("toUIMessageStreamResponse", () => {
  it("rebuilds into the parts a client renders", async () => {
    const { message } = await bridge();

    expect(message?.parts.map((part) => part.type)).toEqual([
      "step-start",
      "reasoning",
      "text",
      "tool-ingestPrepare",
      "tool-ingestList",
      "step-start",
      "text",
    ]);
    expect(message?.parts).toMatchObject([
      {},
      { text: "Reading the queue.", state: "done" },
      { text: "One file is locked.", state: "done" },
      {
        toolCallId: "call-prepare",
        state: "output-available",
        input: { pathOrId: "2026-01.pdf" },
        output: { ok: false, reason: "input-required" },
      },
      {
        toolCallId: "call-list",
        state: "output-error",
        input: {},
        errorText: "ledger busy",
      },
      {},
      { text: "Done.", state: "done" },
    ]);
  });

  it("masks a secret input and never streams it", async () => {
    const { wire, message } = await bridge();

    expect(wire).not.toContain(SECRET);
    expect(message?.parts[3]).toMatchObject({
      input: { pathOrId: "2026-01.pdf", password: "•••" },
    });
  });

  it("keeps a hidden tool out, its result included", async () => {
    const { wire } = await bridge();

    expect(wire).not.toContain("call-ls");
  });

  it("includes subagent tokens only when asked", async () => {
    const quiet = await bridge();
    const loud = await bridge({ ...OPTIONS, includeSubagents: true });

    expect(quiet.wire).not.toContain("subagent aside");
    expect(loud.message?.parts[2]).toMatchObject({
      text: "One file is locked.subagent aside",
    });
  });

  it("follows the answer with suggestions as a data part", async () => {
    const followUps = vi.fn(() => Promise.resolve(["What is locked"]));
    const { message } = await bridge({ ...OPTIONS, followUps });

    expect(followUps).toHaveBeenCalledWith("One file is locked.Done.");
    expect(message?.parts.at(-1)).toEqual({
      type: "data-suggestions",
      data: ["What is locked"],
    });
  });

  it("treats a failed follow-up as silence", async () => {
    const followUps = vi.fn(() => Promise.reject(new Error("gateway down")));
    const { wire, message } = await bridge({ ...OPTIONS, followUps });

    expect(wire).not.toContain("gateway down");
    expect(message?.parts.at(-1)).toMatchObject({ text: "Done." });
  });
});
