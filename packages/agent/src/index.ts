import type { StructuredToolInterface } from "@langchain/core/tools";
import type { UIMessage } from "ai";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createDeepAgent } from "deepagents";
import { toolErrorMiddleware, ToolInvocationError } from "langchain";

import type { GatewayConfig } from "./model";
import type { AgentKind } from "./registry";
import type { LangGraphEvent } from "./stream";
import type { QuestionScope } from "./tools/ingest";
import { backendFor, SKILLS_PATH } from "./memory";
import { chatModel } from "./model";
import { AGENTS, HIDDEN_TOOLS } from "./registry";
import { toUIMessageStreamResponse } from "./stream";
import { suggestFollowUps } from "./suggest";
import { scopedQuestionTools } from "./tools/ingest";
import { textOf } from "./untyped";

// The gateway key and a CLI-spawning connector both live behind this import.
if ("window" in globalThis) {
  throw new Error("@openledger-cfo/agent is server-only");
}

export interface AgentOptions {
  gateway: GatewayConfig;
  /** Appended to the kind's system prompt: what the app already put on screen. */
  system?: string;
  /** Overrides the kind's superstep ceiling. */
  recursionLimit?: number;
  /** Withheld from this run: the model cannot call a tool it was never given. */
  excludeTools?: readonly string[];
  /** Limits the question tools to the questions these files raised. */
  questionFileIds?: QuestionScope;
  extraTools?: readonly StructuredToolInterface[];
  /** `stream` only: suggestions ride out as a data part after the answer. */
  followUps?: boolean;
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

const plainTextOf = (message: UIMessage): string =>
  textOf(message.parts).trim();

const toChatMessages = (messages: UIMessage[]): ChatMessage[] =>
  messages.flatMap((message) => {
    if (message.role === "system") return [];
    const content = plainTextOf(message);
    if (content.length === 0) return [];
    return [
      message.role === "user"
        ? new HumanMessage(content)
        : new AIMessage(content),
    ];
  });

/**
 * Schema refusals reach the gateway as their issues alone; langchain's text carries
 * every argument and a stack naming the OS account. deepagents keeps this off `task`.
 */
const refusedCalls = toolErrorMiddleware({
  onError: (error) =>
    ToolInvocationError.isInstance(error)
      ? `Error invoking tool '${error.toolCall.name}': ${error.toolError.message}\n Please fix the error and try again.`
      : undefined,
});

/** Stateless: the client's transcript is the whole history every run. */
export const createAgent = (kind: AgentKind, opts: AgentOptions): Agent => {
  const spec = AGENTS[kind];
  const excluded = new Set(opts.excludeTools ?? []);
  const scoped =
    opts.questionFileIds === undefined
      ? []
      : scopedQuestionTools(opts.questionFileIds);
  const replacement = new Map(scoped.map((tool) => [tool.name, tool]));

  const agent = createDeepAgent({
    model: chatModel(opts.gateway),
    tools: [
      ...spec.tools
        .filter((tool) => !excluded.has(tool.name))
        .map((tool) => replacement.get(tool.name) ?? tool),
      ...(opts.extraTools ?? []),
    ],
    systemPrompt: spec.buildSystemPrompt(opts.system),
    backend: backendFor(kind),
    skills: [SKILLS_PATH],
    middleware: [refusedCalls],
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
    stream: (messages, signal) => {
      const asked = messages
        .filter((message) => message.role === "user")
        .map(plainTextOf)
        .filter((text) => text.length > 0);

      return toUIMessageStreamResponse(events(messages, signal), {
        hiddenTools: HIDDEN_TOOLS,
        secretInputs: spec.secretInputs,
        followUps: opts.followUps
          ? (answer) =>
              suggestFollowUps({
                asked,
                answer,
                system: opts.system,
                gateway: opts.gateway,
                signal,
              })
          : undefined,
      });
    },
  };
};

export type { GatewayConfig } from "./model";
export type { AgentKind } from "./registry";
export { nsDepth, unwrap } from "./stream";
export type { LangGraphEvent } from "./stream";
export { startIngestRunTool } from "./tools/ingest";
