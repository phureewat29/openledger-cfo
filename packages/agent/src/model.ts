import { homedir } from "node:os";
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
import { attemptAsync, uniq } from "es-toolkit";

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

type VocabSource = () => Promise<VocabEntry[]>;

/**
 * Reads every source per model call, one shared read per overlap. A failed source
 * reuses its last good read, so a busy ledger cannot un-hide an earlier placeholder.
 */
export const createRedactorSource = (
  sources: readonly VocabSource[],
): RedactorProvider => {
  let inFlight: Promise<Redactor> | undefined;
  let lastGood: VocabEntry[][] = sources.map(() => []);

  const build = async (): Promise<Redactor> => {
    const reads = await Promise.all(sources.map((read) => attemptAsync(read)));
    lastGood = reads.map(
      ([, entries], index) => entries ?? lastGood[index] ?? [],
    );
    return createRedactor(lastGood.flat());
  };

  return () => {
    inFlight ??= build().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
};

/** A Windows home arrives in either drive case, either separator, or JSON-doubled backslashes. */
export const homeSpellings = (
  home: string,
  platform: NodeJS.Platform,
): string[] => {
  if (platform !== "win32") return [home];
  const drive = home.slice(0, 1);
  const rest = home.slice(1);
  return uniq(
    [drive.toUpperCase(), drive.toLowerCase()].flatMap((letter) => {
      const path = `${letter}${rest}`;
      return [path, path.replaceAll("\\", "/"), path.replaceAll("\\", "\\\\")];
    }),
  );
};

/** Paths in tool errors and stack traces name the OS account through the home directory. */
const homeDirectory = (): Promise<VocabEntry[]> =>
  Promise.resolve(
    homeSpellings(homedir(), process.platform).map((value) => ({
      category: "U" as const,
      value,
    })),
  );

const userName = async (): Promise<VocabEntry[]> => {
  const status = await caller.ledger.status();
  return [{ category: "U", value: status.user_name }];
};

/** `bank_name` is a public institution and stays in the clear. */
const accountLabels = async (): Promise<VocabEntry[]> => {
  const page = await caller.ledger.accounts.list();
  return page.rows.flatMap((row) => [
    { category: "A" as const, value: row.name },
    ...(row.account_number_masked === null
      ? []
      : [{ category: "K" as const, value: row.account_number_masked }]),
  ]);
};

/** `rel_path` uses `/` everywhere; a Windows path spells it with backslashes. */
export const relPathSpellings = (
  relPath: string,
  platform: NodeJS.Platform,
): string[] =>
  platform === "win32"
    ? uniq([relPath, relPath.replaceAll("/", "\\")])
    : [relPath];

const statementNames = async (): Promise<VocabEntry[]> => {
  const page = await caller.ledger.ingest.list();
  return page.rows.flatMap((row) =>
    relPathSpellings(row.rel_path, process.platform).map((value) => ({
      category: "F" as const,
      value,
    })),
  );
};

/** One per process, so the last good vocabulary outlives the turn that read it. */
const currentRedactor = createRedactorSource([
  homeDirectory,
  userName,
  accountLabels,
  statementNames,
]);

/** A chat run carries one prompt and one completion, so both indices are fixed. */
const TOKEN_INDICES = { prompt: 0, completion: 0 };

/**
 * Holds every call on `/chat/completions`, the gateway contract. `ChatOpenAI` routes some ids
 * to `/responses` (utils/misc.js:89) whatever `useResponsesApi` says (chat_models/index.js:642).
 */
export class CompletionsChatOpenAI extends ChatOpenAI {
  protected override _useResponsesApi(): boolean {
    return false;
  }

  /** This model with no call options bound; a subclass holding more than its fields says how. */
  protected unbound(): CompletionsChatOpenAI {
    return new CompletionsChatOpenAI(this.fields ?? {});
  }

  /**
   * The base hard-codes `new ChatOpenAI(this.fields)` (chat_models/index.js:673) and `bindTools`
   * (chat_models/base.js:353) routes through it, so deepagents would get a plain model.
   */
  override withConfig(
    config: Partial<ChatOpenAICallOptions>,
  ): CompletionsChatOpenAI {
    const bound = this.unbound();
    bound.defaultOptions = { ...this.defaultOptions, ...config };
    return bound;
  }
}

/**
 * Redaction at the one boundary all gateway traffic crosses. `withConfig` and the two stream
 * entry points would route around it; they are unversioned internals, hence the exact pins.
 */
export class RedactingChatOpenAI extends CompletionsChatOpenAI {
  private readonly redactorOf: RedactorProvider;

  constructor(fields: ChatOpenAIFields, redactorOf: RedactorProvider) {
    // `true` streams `_generate` on raw tokens; a literal `false` sets `disableStreaming`, making
    // `.stream()` one buffered `invoke` (chat_models/base.js:263-265). Absent is both off.
    super({ ...fields, streaming: undefined });
    this.redactorOf = redactorOf;
  }

  protected override unbound(): RedactingChatOpenAI {
    return new RedactingChatOpenAI(this.fields ?? {}, this.redactorOf);
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

    // The provider fires `handleLLMNewToken` with its raw chunk (chat_models/completions.js:232);
    // withholding the run manager makes this the only emitter, so no placeholder leaks.
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
   * The facade hands this straight to its completions client (chat_models/index.js:659),
   * past the override above; bridging through our own chunks is what core's default does.
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
    : new CompletionsChatOpenAI(fields);
};
