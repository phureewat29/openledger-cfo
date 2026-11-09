import { homedir } from "node:os";
import type { BaseMessage } from "@langchain/core/messages";
import type { UIMessage } from "ai";
import { AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgent } from "./index";

// The real backend copies skills into the app's own agent workspace.
vi.mock("./memory", () => ({
  backendFor: () => undefined,
  SKILLS_PATH: "/skills/",
}));

const GATEWAY = {
  baseUrl: "http://127.0.0.1:9",
  apiKey: "",
  model: "probe",
  redact: false,
};

const ASK: UIMessage[] = [
  { id: "ask", role: "user", parts: [{ type: "text", text: "Go on." }] },
];

const reply = (message: AIMessageChunk) =>
  new ChatGenerationChunk({ text: message.text, message });

describe("a tool call its schema refuses", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["cfo", "getReport", { from: "last month" }, "from"],
    ["ingest", "ingestPrepare", { pathOrId: "" }, "pathOrId"],
  ] as const)(
    "reaches the %s gateway as its issues alone",
    async (kind, name, args, field) => {
      const sent: BaseMessage[][] = [];
      vi.spyOn(
        ChatOpenAI.prototype,
        "_streamResponseChunks",
      ).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/require-await
        async function* (messages: BaseMessage[]) {
          sent.push(messages);
          yield sent.length === 1
            ? reply(
                new AIMessageChunk({
                  content: "",
                  tool_call_chunks: [
                    {
                      index: 0,
                      id: "call-1",
                      name,
                      args: JSON.stringify(args),
                    },
                  ],
                }),
              )
            : reply(new AIMessageChunk({ content: "Fixed." }));
        },
      );

      for await (const event of createAgent(kind, { gateway: GATEWAY }).events(
        ASK,
      )) {
        expect(event.event).toBeTypeOf("string");
      }
      const refusal = sent[1]?.find((message) =>
        ToolMessage.isInstance(message),
      );

      expect(refusal).toMatchObject({
        status: "error",
        tool_call_id: "call-1",
      });
      expect(refusal?.text).toContain(field);
      expect(refusal?.text).not.toContain(homedir());
      expect(refusal?.text).not.toMatch(/^\s+at /mu);
    },
  );
});
