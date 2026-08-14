import type { StructuredToolInterface } from "@langchain/core/tools";
import type { UIMessage } from "ai";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createDeepAgent } from "deepagents";

import type { AgentKind } from "./registry";
import type { LangGraphEvent } from "./stream";
import type { QuestionScope } from "./tools/ingest";
import { backendFor, SKILLS_PATH } from "./memory";
import { model } from "./model";
import { AGENTS } from "./registry";
import { toUIMessageStreamResponse } from "./stream";
import { scopedQuestionTools } from "./tools/ingest";

// The gateway key and a CLI-spawning connector both live behind this import.
if ("window" in globalThis) {
  throw new Error("@openledger-fleet/agent is server-only");
}

export interface AgentOptions {
  /** Appended to the kind's system prompt: what the app already put on screen. */
  system?: string;
  /** Overrides `OPENAI_COMPATIBLE_MODEL` for this run; the id the gateway routes on. */
  model?: string;
  /** Raises the kind's ceiling for a caller whose one turn spans several files. */
  recursionLimit?: number;
  /**
   * Tool names this run must not hold. A caller that wants work left undone
   * takes the tool away rather than asking for restraint in the prompt: the
   * model cannot call what it was never given.
   */
  excludeTools?: readonly string[];
  /**
   * The files this run is working. Given, the question tools see only the
   * questions those files raised; the ledger's open queue holds other runs'
   * work, and answering that is nobody's idea of finishing this one.
   */
  questionFileIds?: QuestionScope;
  /**
   * Tools the caller owns that this package cannot: the app's runner lives
   * behind its own module graph, so the app hands the tool in rather than
   * being imported from here.
   */
  extraTools?: readonly StructuredToolInterface[];
}

export interface Agent {
  /** The raw graph events, for callers that want more than the chat transport. */
  events: (
    messages: UIMessage[],
    signal?: AbortSignal,
  ) => AsyncIterable<LangGraphEvent>;
  /** An AI SDK UI message stream, byte-compatible with `useChat`. */
  stream: (messages: UIMessage[], signal?: AbortSignal) => Response;
}

type ChatMessage = AIMessage | HumanMessage;

const textOf = (message: UIMessage): string =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

const toChatMessages = (messages: UIMessage[]): ChatMessage[] =>
  messages.flatMap((message) => {
    if (message.role === "system") return [];
    const content = textOf(message);
    if (content.length === 0) return [];
    return [
      message.role === "user"
        ? new HumanMessage(content)
        : new AIMessage(content),
    ];
  });

/** Stateless: the client's transcript is the whole history every run. */
export const createAgent = (
  kind: AgentKind,
  opts: AgentOptions = {},
): Agent => {
  const spec = AGENTS[kind];
  const excluded = new Set(opts.excludeTools ?? []);
  const scoped =
    opts.questionFileIds === undefined
      ? []
      : scopedQuestionTools(opts.questionFileIds);
  const replacement = new Map(scoped.map((tool) => [tool.name, tool]));

  const agent = createDeepAgent({
    model: model(opts.model),
    tools: [
      ...spec.tools
        .filter((tool) => !excluded.has(tool.name))
        .map((tool) => replacement.get(tool.name) ?? tool),
      ...(opts.extraTools ?? []),
    ],
    systemPrompt: spec.buildSystemPrompt(opts.system),
    backend: backendFor(spec),
    skills: [SKILLS_PATH],
  });

  const events = (
    messages: UIMessage[],
    signal?: AbortSignal,
  ): AsyncIterable<LangGraphEvent> =>
    agent.streamEvents(
      { messages: toChatMessages(messages) },
      {
        version: "v2",
        recursionLimit: opts.recursionLimit ?? spec.recursionLimit,
        signal,
      },
      // Structurally the same events; the cast keeps graph internals out of the bridge.
    ) as AsyncIterable<LangGraphEvent>;

  return {
    events,
    stream: (messages, signal) =>
      toUIMessageStreamResponse(events(messages, signal), {
        hiddenTools: spec.hiddenTools,
        secretInputs: spec.secretInputs,
      }),
  };
};

export { isAiEnabled } from "./model";
export type { AgentKind } from "./registry";
export { nsDepth, textOf, unwrap } from "./stream";
export type { LangGraphEvent } from "./stream";
export { startIngestRunTool } from "./tools/runner";
export type {
  RunnerMode,
  StartIngestRun,
  StartRunOutcome,
} from "./tools/runner";
