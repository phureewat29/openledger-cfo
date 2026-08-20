import { createHash } from "node:crypto";
import type {
  BaseMessage,
  BaseMessageFields,
  MessageContent,
  OpenAIToolCall,
  ToolCall,
  ToolCallChunk,
} from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import {
  compact,
  countBy,
  escapeRegExp,
  isPlainObject,
  mapValues,
  omit,
  uniqBy,
} from "es-toolkit";

/**
 * Pseudonymizes the user's personal data on its way to an external model and
 * restores it on the way back. Institutions — banks, brokers, merchants — are
 * public facts and stay in the clear; what leaves is the account labels, masked
 * numbers, names, filenames, long digit runs and emails that identify a person.
 *
 * Every transform is total and deterministic: one value always yields one
 * placeholder, so a conversation stays coherent across turns and two processes
 * redact the same prompt byte for byte.
 */

/**
 * A account name, K masked account number, U user name, F filename,
 * N digit-run pattern hit, E email pattern hit.
 */
export type Category = "A" | "K" | "U" | "F" | "N" | "E";

export interface VocabEntry {
  readonly category: Category;
  readonly value: string;
}

/** Closures, not methods: every member is safe to detach and pass along. */
export interface Redactor {
  readonly redactText: (text: string) => string;
  readonly restoreText: (text: string) => string;
  readonly restoreJsonFragment: (fragment: string) => string;
  readonly redactMessage: (message: BaseMessage) => BaseMessage;
  readonly restoreResult: (result: ChatResult) => ChatResult;
  readonly chunkRestorer: () => ChunkRestorer;
}

export interface Stitcher {
  readonly push: (delta: string) => string;
  readonly flush: () => string;
}

export interface ChunkRestorer {
  readonly push: (chunk: ChatGenerationChunk) => ChatGenerationChunk;
  readonly flush: () => ChatGenerationChunk | undefined;
}

const OPEN = "⟦";
const CLOSE = "⟧";
const SHORT_HEX = 8;
const LONG_HEX = 16;

/** The one place the placeholder shape lives; an ASCII fallback swaps these. */
const tokenOf = (category: Category, hex: string): string =>
  `${OPEN}${category}-${hex}${CLOSE}`;

const TOKEN_SOURCE = `${OPEN}[A-Z]-[0-9a-f]{${String(SHORT_HEX)},${String(LONG_HEX)}}${CLOSE}`;

const TOKEN_RE = new RegExp(TOKEN_SOURCE, "gu");

/** What a stream may legally end with mid-placeholder, bounded at 19 units. */
const PARTIAL_TOKEN_RE = new RegExp(
  `^${OPEN}(?:[A-Z](?:-[0-9a-f]{0,${String(LONG_HEX)}})?)?$`,
  "u",
);

const MIN_VOCAB_LENGTH = 3;
const MIN_RUN_DIGITS = 10;

const EMAIL_SOURCE = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";
const MASKED_SOURCE = "\\*{2,}\\d{2,}";
/**
 * Account numbers are written with single spaces or dashes inside them. The
 * lookbehind keeps a run from starting mid-number — without it `85,000.50 1234567890`
 * would join the `50` of the price to the account that follows it.
 */
const DIGIT_RUN_SOURCE = "(?<![.,\\d])\\d+(?:[ -]\\d+)*";

const digitsIn = (value: string): number => value.replace(/\D/gu, "").length;

interface PatternRule {
  readonly category: Category;
  readonly source: string;
  /** A shape the regex alone cannot decide; a rejected match stays in the clear. */
  readonly accept?: (match: string) => boolean;
}

const PATTERNS: readonly PatternRule[] = [
  { category: "E", source: EMAIL_SOURCE },
  { category: "K", source: MASKED_SOURCE },
  {
    category: "N",
    source: DIGIT_RUN_SOURCE,
    accept: (match) => digitsIn(match) >= MIN_RUN_DIGITS,
  },
];

/** Which rule owns a match the master regex already found, if any still wants it. */
const categoryOf = (() => {
  const rules = PATTERNS.map((rule) => {
    const anchored = new RegExp(`^(?:${rule.source})$`, "u");
    return {
      category: rule.category,
      claims: (match: string) =>
        anchored.test(match) && (rule.accept?.(match) ?? true),
    };
  });
  return (match: string): Category | undefined =>
    rules.find((rule) => rule.claims(match))?.category;
})();

const digestOf = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

interface Vocabulary {
  readonly category: Category;
  readonly value: string;
  readonly token: string;
}

/**
 * Short values match too much prose to be worth hiding, and the first category
 * given to a value wins so a term listed twice cannot get two placeholders.
 * Two values sharing an 8-char digest prefix both widen to 16, which keeps a
 * value's placeholder a function of the vocabulary rather than of arrival order.
 */
const prepare = (entries: readonly VocabEntry[]): Vocabulary[] => {
  const candidates = uniqBy(
    entries.filter((entry) => entry.value.length >= MIN_VOCAB_LENGTH),
    (entry) => entry.value,
  ).map((entry) => {
    const hex = digestOf(entry.value);
    return {
      ...entry,
      short: hex.slice(0, SHORT_HEX),
      long: hex.slice(0, LONG_HEX),
    };
  });
  const sharing = countBy(candidates, (candidate) => candidate.short);
  return candidates.map(({ category, value, short, long }) => ({
    category,
    value,
    token: tokenOf(category, sharing[short] === 1 ? short : long),
  }));
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

/** Valid JSON never parses to `undefined`, so it doubles as the failure signal. */
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** Walks string values only: keys, numbers, booleans and structure are facts. */
const walkJson = (value: unknown, map: (text: string) => string): unknown => {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((item) => walkJson(item, map));
  if (!isPlainObject(value)) return value;
  return mapValues(value, (item) => walkJson(item, map));
};

/**
 * The prose a content block carries, if any. Images and thinking blocks have
 * none, and pass through every transform untouched.
 */
const proseOf = (block: unknown): string | undefined => {
  const record = asRecord(block);
  return record.type === "text" && typeof record.text === "string"
    ? record.text
    : undefined;
};

const transformBlock = (
  block: unknown,
  map: (text: string) => string,
): unknown => {
  const prose = proseOf(block);
  return prose === undefined ? block : { ...asRecord(block), text: map(prose) };
};

const transformContent = (
  content: unknown,
  map: (text: string) => string,
): MessageContent => {
  if (typeof content === "string") return map(content);
  if (!Array.isArray(content)) return content as MessageContent;
  return content.map((block) => transformBlock(block, map)) as MessageContent;
};

const textOf = (content: MessageContent): string =>
  typeof content === "string"
    ? content
    : compact(content.map(proseOf)).join("");

/** One direction of travel: plain prose, and prose held inside a JSON string. */
interface TextPass {
  readonly text: (value: string) => string;
  readonly jsonText: (value: string) => string;
}

type Kwargs = BaseMessage["additional_kwargs"];

const transformRawCall = (
  call: OpenAIToolCall,
  pass: TextPass,
): OpenAIToolCall => ({
  ...call,
  function: {
    ...call.function,
    arguments: pass.jsonText(call.function.arguments),
  },
});

const transformKwargs = (kwargs: Kwargs, pass: TextPass): Kwargs => ({
  ...kwargs,
  ...(kwargs.tool_calls && {
    tool_calls: kwargs.tool_calls.map((call) => transformRawCall(call, pass)),
  }),
  ...(typeof kwargs.reasoning_content === "string" && {
    reasoning_content: pass.text(kwargs.reasoning_content),
  }),
});

const commonFields = (message: BaseMessage, content: MessageContent) => ({
  id: message.id,
  name: message.name,
  content,
  additional_kwargs: message.additional_kwargs,
  response_metadata: message.response_metadata,
});

type MessageConstructor = new (fields: BaseMessageFields) => BaseMessage;

/**
 * The fallback for a message type this module does not know: rebuild it through
 * its own constructor so an exotic type still leaves with its prose redacted.
 */
const transformOther = (message: BaseMessage, pass: TextPass): BaseMessage => {
  const Constructor = message.constructor as MessageConstructor;
  return new Constructor({
    ...message,
    content: transformContent(message.content, pass.text),
  } as BaseMessageFields);
};

const rebuildProse =
  (Constructor: MessageConstructor) =>
  (message: BaseMessage, pass: TextPass): BaseMessage =>
    new Constructor(
      commonFields(
        message,
        transformContent(message.content, pass.text),
      ) as BaseMessageFields,
    );

const transformAI = (message: AIMessage, pass: TextPass): AIMessage =>
  new AIMessage({
    ...commonFields(message, transformContent(message.content, pass.text)),
    additional_kwargs: transformKwargs(message.additional_kwargs, pass),
    tool_calls: message.tool_calls?.map((call: ToolCall) => ({
      ...call,
      args: walkJson(call.args, pass.text) as Record<string, unknown>,
    })),
    invalid_tool_calls: message.invalid_tool_calls?.map((call) => ({
      ...call,
      args: call.args === undefined ? undefined : pass.jsonText(call.args),
    })),
    usage_metadata: message.usage_metadata,
  });

const redactAI = (message: BaseMessage, pass: TextPass): BaseMessage =>
  AIMessage.isInstance(message)
    ? transformAI(message, pass)
    : transformOther(message, pass);

const redactTool = (message: BaseMessage, pass: TextPass): BaseMessage => {
  if (!ToolMessage.isInstance(message)) return transformOther(message, pass);
  return new ToolMessage({
    ...commonFields(message, transformContent(message.content, pass.jsonText)),
    tool_call_id: message.tool_call_id,
    status: message.status,
    metadata: message.metadata,
    // Never serialized to the wire: the runtime reads it, the model never sees it.
    artifact: message.artifact as unknown,
  });
};

const REDACTORS: Record<
  string,
  (message: BaseMessage, pass: TextPass) => BaseMessage
> = {
  system: rebuildProse(SystemMessage),
  human: rebuildProse(HumanMessage),
  ai: redactAI,
  tool: redactTool,
};

/**
 * Buffers a stream just enough to never cut a placeholder in half: text after
 * the last `⟦` is held back while it still reads as a placeholder in the making.
 * An earlier `⟦` cannot start one, since the placeholder alphabet excludes it.
 */
export const createStitcher = (restore: (text: string) => string): Stitcher => {
  let buffer = "";

  const take = (upto: number): string => {
    const emitted = restore(buffer.slice(0, upto));
    buffer = buffer.slice(upto);
    return emitted;
  };

  return {
    push(delta) {
      buffer += delta;
      const open = buffer.lastIndexOf(OPEN);
      if (open === -1) return take(buffer.length);
      return PARTIAL_TOKEN_RE.test(buffer.slice(open))
        ? take(open)
        : take(buffer.length);
    },
    flush() {
      return take(buffer.length);
    },
  };
};

export const createRedactor = (entries: readonly VocabEntry[]): Redactor => {
  const vocabulary = prepare(entries);
  const originals = new Map(vocabulary.map((item) => [item.token, item.value]));
  const tokens = new Map(vocabulary.map((item) => [item.value, item.token]));

  /**
   * A placeholder for a value the vocabulary never saw. Should its digest
   * prefix already belong to another value, this one takes the wider form —
   * the vocabulary's own collisions are settled up front, in {@link prepare}.
   */
  const claim = (category: Category, value: string): string => {
    const hex = digestOf(value);
    const short = tokenOf(category, hex.slice(0, SHORT_HEX));
    const owner = originals.get(short);
    if (owner === undefined || owner === value) {
      originals.set(short, value);
      return short;
    }
    const long = tokenOf(category, hex.slice(0, LONG_HEX));
    originals.set(long, value);
    return long;
  };

  /**
   * One pass, one regex. A placeholder is listed first so a second redaction
   * leaves it alone — and so hex that reads as a digit run cannot be re-hidden.
   * Vocabulary comes next, longest first, which is what makes a specific account
   * name win over the bank prefix it starts with.
   */
  const master = new RegExp(
    [
      TOKEN_SOURCE,
      ...vocabulary
        .map((item) => item.value)
        .toSorted((left, right) => right.length - left.length)
        .map(escapeRegExp),
      ...PATTERNS.map((rule) => rule.source),
    ].join("|"),
    "gu",
  );

  const replace = (match: string): string => {
    if (match.startsWith(OPEN)) return match;
    const known = tokens.get(match);
    if (known !== undefined) return known;
    const category = categoryOf(match);
    return category === undefined ? match : claim(category, match);
  };

  const redactText = (text: string): string => text.replace(master, replace);

  const restoreText = (text: string): string =>
    text.replace(TOKEN_RE, (token) => originals.get(token) ?? token);

  /**
   * The fragment sits inside a JSON string literal, so an original carrying a
   * quote or a backslash has to arrive already escaped for it.
   */
  const restoreJsonFragment = (fragment: string): string =>
    fragment.replace(TOKEN_RE, (token) => {
      const original = originals.get(token);
      return original === undefined
        ? token
        : JSON.stringify(original).slice(1, -1);
    });

  /** Text that claims to be JSON is walked as JSON; anything else is prose. */
  const jsonPass =
    (map: (text: string) => string, fallback: (text: string) => string) =>
    (text: string): string => {
      const parsed = parseJson(text);
      return parsed === undefined
        ? fallback(text)
        : JSON.stringify(walkJson(parsed, map));
    };

  // Redaction only ever inserts placeholder characters, so a malformed JSON
  // string can be patched as prose; restoration has to escape what it puts back.
  const REDACT: TextPass = {
    text: redactText,
    jsonText: jsonPass(redactText, redactText),
  };
  const RESTORE: TextPass = {
    text: restoreText,
    jsonText: jsonPass(restoreText, restoreJsonFragment),
  };

  const redactMessage = (message: BaseMessage): BaseMessage => {
    const handler = REDACTORS[message.type] ?? transformOther;
    return handler(message, REDACT);
  };

  const restoreMessage = (message: BaseMessage): BaseMessage =>
    AIMessage.isInstance(message)
      ? transformAI(message, RESTORE)
      : transformOther(message, RESTORE);

  const restoreResult = (result: ChatResult): ChatResult => ({
    ...result,
    generations: result.generations.map((generation) => ({
      ...generation,
      text: restoreText(generation.text),
      message: restoreMessage(generation.message),
    })),
  });

  const chunkRestorer = (): ChunkRestorer => {
    const prose = createStitcher(restoreText);
    const reasoning = createStitcher(restoreText);
    const fragments = new Map<number, Stitcher>();

    const fragmentOf = (index: number): Stitcher => {
      const existing = fragments.get(index);
      if (existing !== undefined) return existing;
      const created = createStitcher(restoreJsonFragment);
      fragments.set(index, created);
      return created;
    };

    const restoreArgs = (part: ToolCallChunk): ToolCallChunk => ({
      ...part,
      args:
        part.args === undefined
          ? undefined
          : fragmentOf(part.index ?? 0).push(part.args),
    });

    /**
     * The delta converter copies each raw tool-call fragment into
     * `additional_kwargs.tool_calls` as well (converters/completions.js:261).
     * Those are dropped rather than mirrored: a second pass through the
     * per-index stitchers would corrupt their state, and leaving them be would
     * aggregate into a message whose `tool_calls` read true while its kwargs
     * still held placeholders. `tool_call_chunks` is the copy that survives.
     */
    const restoreKwargs = (kwargs: Kwargs): Kwargs =>
      omit(
        typeof kwargs.reasoning_content === "string"
          ? {
              ...kwargs,
              reasoning_content: reasoning.push(kwargs.reasoning_content),
            }
          : kwargs,
        ["tool_calls"],
      );

    return {
      push(chunk) {
        const message = chunk.message;
        const content = transformContent(message.content, (delta) =>
          prose.push(delta),
        );
        const isAi = AIMessageChunk.isInstance(message);
        return new ChatGenerationChunk({
          text: textOf(content),
          generationInfo: chunk.generationInfo,
          message: new AIMessageChunk({
            id: message.id,
            name: message.name,
            content,
            additional_kwargs: restoreKwargs(message.additional_kwargs),
            response_metadata: message.response_metadata,
            tool_call_chunks: isAi
              ? message.tool_call_chunks?.map(restoreArgs)
              : undefined,
            usage_metadata: isAi ? message.usage_metadata : undefined,
          }),
        });
      },

      flush() {
        const rest = prose.flush();
        const thought = reasoning.flush();
        // A remainder is a stream that stopped mid-placeholder: it goes out
        // verbatim, and argument fragments go back as fragments so the
        // aggregated tool call keeps whatever JSON it managed to receive.
        const args = [...fragments.entries()]
          .map(([index, stitcher]) => ({ index, args: stitcher.flush() }))
          .filter((part) => part.args !== "");
        if (rest === "" && thought === "" && args.length === 0)
          return undefined;
        return new ChatGenerationChunk({
          text: rest,
          message: new AIMessageChunk({
            content: rest,
            ...(thought === ""
              ? {}
              : { additional_kwargs: { reasoning_content: thought } }),
            ...(args.length === 0 ? {} : { tool_call_chunks: args }),
          }),
        });
      },
    };
  };

  return {
    redactText,
    restoreText,
    restoreJsonFragment,
    redactMessage,
    restoreResult,
    chunkRestorer,
  };
};
