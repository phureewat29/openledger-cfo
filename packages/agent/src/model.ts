import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatModelStreamEvent } from "@langchain/core/language_models/event";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import type {
  ChatOpenAICallOptions,
  ChatOpenAIFields,
} from "@langchain/openai";
import { convertChunksToEvents } from "@langchain/core/language_models/compat";
import { ChatOpenAI } from "@langchain/openai";

import type { Redactor, VocabEntry } from "./redaction";
import { createRedactor } from "./redaction";
import { caller } from "./tools/caller";

/**
 * The runtime's own port; the caller injects it. The api store declares the
 * same shape structurally — core stays out of the persistence context, which
 * only the `tools/caller` adapter reaches.
 */
export interface GatewayConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly redact: boolean;
}

type RedactorProvider = () => Promise<Redactor>;

/**
 * A ledger read that fails contributes nothing rather than ending the turn.
 * The residual is deliberate: in a fresh process with an unreachable ledger
 * there is no last-good vocabulary to fall back on, so the re-POSTed history
 * is redacted by pattern only and earlier turns' real names go out in the
 * clear. An answerable turn is worth more than a perfectly hidden one.
 */
const guarded = async (
  read: () => Promise<VocabEntry[]>,
): Promise<VocabEntry[]> => {
  try {
    return await read();
  } catch {
    return [];
  }
};

const userName = async (): Promise<VocabEntry[]> => {
  const status = await caller.ledger.status();
  return [{ category: "U", value: status.user_name }];
};

/**
 * The label and the masked number are the user's; `bank_name` is a public
 * institution and stays in the clear, so the model can still reason about it.
 */
const accountLabels = async (): Promise<VocabEntry[]> => {
  const page = await caller.ledger.accounts.list();
  return page.rows.flatMap((row) => [
    { category: "A" as const, value: row.name },
    ...(row.account_number_masked === null
      ? []
      : [{ category: "K" as const, value: row.account_number_masked }]),
  ]);
};

const statementNames = async (): Promise<VocabEntry[]> => {
  const page = await caller.ledger.ingest.list();
  return page.rows.map((row) => ({
    category: "F" as const,
    value: row.rel_path,
  }));
};

const SOURCES: readonly (() => Promise<VocabEntry[]>)[] = [
  userName,
  accountLabels,
  statementNames,
];

let inFlight: Promise<Redactor> | null = null;
let lastGood: Redactor | null = null;

const build = async (): Promise<Redactor> => {
  const batches = await Promise.all(SOURCES.map((source) => guarded(source)));
  const entries = batches.flat();
  // Every source failing at once must not quietly send a turn out in the clear.
  if (entries.length === 0 && lastGood !== null) return lastGood;
  lastGood = createRedactor(entries);
  return lastGood;
};

/**
 * Read fresh for each model call: a model call follows tool execution, so an
 * account the agent just created is already hidden on the turn that reports it.
 * Calls that overlap within a turn share the one read.
 */
const currentRedactor: RedactorProvider = () => {
  if (inFlight !== null) return inFlight;
  const pending = build().finally(() => {
    inFlight = null;
  });
  inFlight = pending;
  return pending;
};

/** A chat run carries one prompt and one completion, so both indices are fixed. */
const TOKEN_INDICES = { prompt: 0, completion: 0 };

/**
 * Redaction sits at the one boundary all gateway traffic crosses. Three escapes
 * in `@langchain/openai@1.5.6` would route around it; each override below shuts
 * one, and the versions are pinned because the escapes are unversioned internals.
 */
export class RedactingChatOpenAI extends ChatOpenAI {
  private readonly redactorOf: RedactorProvider;

  constructor(fields: ChatOpenAIFields, redactorOf: RedactorProvider) {
    // Neither `true` nor `false` will do (chat_models/base.js:255-257): `true`
    // makes `_generate` stream internally on raw-token callbacks, while a
    // literal `false` sets `disableStreaming`, which turns every `.stream()`
    // into one buffered `invoke` (core chat_models.js:131). Absent is both off.
    super({ ...fields, streaming: undefined });
    this.redactorOf = redactorOf;
  }

  /**
   * `withConfig` hard-codes `new ChatOpenAI(this.fields)` (chat_models/index.js:605),
   * and `bindTools` (chat_models/base.js:344) and `withStructuredOutput` route
   * through it — deepagents reaches the model by `bindTools`, so without this
   * every real call would run on a plain, unredacted model.
   */
  override withConfig(
    config: Partial<ChatOpenAICallOptions>,
  ): RedactingChatOpenAI {
    const bound = new RedactingChatOpenAI(this.fields ?? {}, this.redactorOf);
    bound.defaultOptions = { ...this.defaultOptions, ...config };
    return bound;
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const redactor = await this.redactorOf();
    const result = await super._generate(
      messages.map((message) => redactor.redactMessage(message)),
      options,
      runManager,
    );
    return redactor.restoreResult(result);
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const redactor = await this.redactorOf();
    const restorer = redactor.chunkRestorer();
    const redacted = messages.map((message) => redactor.redactMessage(message));

    const emit = async (chunk: ChatGenerationChunk): Promise<void> => {
      await runManager?.handleLLMNewToken(
        chunk.text,
        TOKEN_INDICES,
        undefined,
        undefined,
        undefined,
        { chunk },
      );
    };

    // Stream events are built from `handleLLMNewToken`, which the provider fires
    // from inside its own generator with the chunk it just yielded
    // (chat_models/completions.js:219). Withholding the run manager from `super`
    // leaves this the only emitter, so no placeholder reaches a listener.
    for await (const chunk of super._streamResponseChunks(
      redacted,
      options,
      undefined,
    )) {
      const restored = restorer.push(chunk);
      await emit(restored);
      yield restored;
    }

    const rest = restorer.flush();
    if (rest === undefined) return;
    await emit(rest);
    yield rest;
  }

  /**
   * ChatOpenAI's facade hands this straight to its completions client
   * (chat_models/index.js:591), which never reaches the override above. Bridging
   * through our own chunks is what core's default does. Nothing in this app takes
   * that path today; the override keeps it from opening one silently.
   */
  override async *_streamChatModelEvents(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatModelStreamEvent> {
    yield* convertChunksToEvents(
      this._streamResponseChunks(messages, options, runManager),
      { signal: options.signal },
    );
  }
}

/** Any OpenAI-wire endpoint; the config is injected — this package holds no credentials. */
export const chatModel = (gateway: GatewayConfig): ChatOpenAI => {
  const fields: ChatOpenAIFields = {
    model: gateway.model,
    // The client refuses to construct without one; keyless endpoints ignore it.
    apiKey: gateway.apiKey === "" ? "none" : gateway.apiKey,
    // Figures are read from the ledger, never sampled.
    temperature: 0,
    configuration: { baseURL: gateway.baseUrl },
  };
  return gateway.redact
    ? new RedactingChatOpenAI(fields, currentRedactor)
    : new ChatOpenAI(fields);
};
