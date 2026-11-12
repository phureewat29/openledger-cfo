import { homedir } from "node:os";
import { join } from "node:path";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import {
  ChatOpenAI,
  ChatOpenAICompletions,
  ChatOpenAIResponses,
} from "@langchain/openai";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VocabEntry } from "./redaction";
import { chatModel, createRedactorSource, RedactingChatOpenAI } from "./model";
import { createRedactor } from "./redaction";

// The app's redactor reads names through the ledger, which a test must not spawn.
vi.mock("./tools/caller", () => {
  const offline = () => Promise.reject(new Error("no ledger in tests"));
  return {
    caller: {
      ledger: {
        status: offline,
        accounts: { list: offline },
        ingest: { list: offline },
      },
    },
  };
});

const GATEWAY = {
  baseUrl: "http://127.0.0.1:9",
  apiKey: "",
  model: "probe",
  redact: true,
};

const ACCOUNT = "KBank Wealth Current";
const USER = "ครัวซองต์ คอร์กี้";

const VOCAB: VocabEntry[] = [
  { category: "A", value: ACCOUNT },
  { category: "U", value: USER },
];

/** `bindTools` is declared as returning a bare `Runnable`; the class is the claim. */
const asRedacting = (runnable: unknown): RedactingChatOpenAI => {
  expect(runnable).toBeInstanceOf(RedactingChatOpenAI);
  return runnable as RedactingChatOpenAI;
};

describe("chatModel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a redacting model only when the toggle is on", () => {
    expect(chatModel(GATEWAY)).toBeInstanceOf(RedactingChatOpenAI);
    expect(chatModel({ ...GATEWAY, redact: false })).not.toBeInstanceOf(
      RedactingChatOpenAI,
    );
  });

  it("hides the home directory, whose paths name the OS account", async () => {
    const crossed: BaseMessage[] = [];
    vi.spyOn(ChatOpenAI.prototype, "_generate").mockImplementation(
      (messages: BaseMessage[]): Promise<ChatResult> => {
        crossed.push(...messages);
        return Promise.resolve({
          generations: [{ text: "ok", message: new AIMessage("ok") }],
        });
      },
    );

    await asRedacting(chatModel(GATEWAY))._generate(
      [new HumanMessage(`Read ${join(homedir(), "Downloads", "a.pdf")}`)],
      {},
    );

    expect(crossed).toHaveLength(1);
    expect(crossed[0]?.text).not.toContain(homedir());
  });
});

describe("createRedactorSource", () => {
  const vocab = (): Promise<VocabEntry[]> => Promise.resolve(VOCAB);
  const broken = (): Promise<VocabEntry[]> =>
    Promise.reject(new Error("ledger busy"));

  it("shares one read between overlapping calls", async () => {
    const read = vi.fn(vocab);
    const redactorOf = createRedactorSource([read]);

    const [first, second] = await Promise.all([redactorOf(), redactorOf()]);

    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("reads fresh once the shared read has settled", async () => {
    const read = vi.fn(vocab);
    const redactorOf = createRedactorSource([read]);

    await redactorOf();
    await redactorOf();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps the rest when a source has never read cleanly", async () => {
    const redactorOf = createRedactorSource([broken, vocab]);
    const redactor = await redactorOf();

    expect(redactor.redactText(ACCOUNT)).not.toContain(ACCOUNT);
  });

  it("keeps a failed source's last good names hidden beside fresh reads", async () => {
    const user = vi.fn(() =>
      Promise.resolve<VocabEntry[]>([{ category: "U", value: USER }]),
    );
    const accounts = vi.fn(() =>
      Promise.resolve<VocabEntry[]>([{ category: "A", value: ACCOUNT }]),
    );
    const redactorOf = createRedactorSource([user, accounts]);
    const line = `${USER} holds ${ACCOUNT}`;
    const first = (await redactorOf()).redactText(line);

    accounts.mockImplementation(broken);
    const second = (await redactorOf()).redactText(line);

    expect(user).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
    expect(second).not.toContain(ACCOUNT);
  });

  it("keeps every last good name hidden when every source fails", async () => {
    const read = vi.fn(vocab);
    const redactorOf = createRedactorSource([read]);
    await redactorOf();

    read.mockImplementation(broken);
    const fallback = await redactorOf();

    expect(fallback.redactText(USER)).not.toContain(USER);
    expect(fallback.redactText(ACCOUNT)).not.toContain(ACCOUNT);
  });

  it("falls back to patterns alone with no good read behind it", async () => {
    const redactorOf = createRedactorSource([broken]);
    const redactor = await redactorOf();

    expect(redactor.redactText(ACCOUNT)).toBe(ACCOUNT);
    expect(redactor.redactText("call 0812345678")).not.toContain("0812345678");
  });
});

/**
 * The subclass only covers gateway traffic while it survives the builders the
 * agent loop reaches it through: `withConfig` hard-codes a plain `ChatOpenAI`,
 * and `bindTools` and `withStructuredOutput` both route there.
 */
describe("RedactingChatOpenAI", () => {
  const model = chatModel(GATEWAY);

  it("survives bindTools", () => {
    asRedacting(model.bindTools([]));
  });

  it("survives withConfig", () => {
    asRedacting(model.withConfig({}));
  });

  it("survives chained builders", () => {
    asRedacting(asRedacting(model.bindTools([])).withConfig({ stop: ["\n"] }));
  });

  it("carries call options through the builders it survives", () => {
    const bound = asRedacting(model.bindTools([])).withConfig({ stop: ["x"] });
    // The completions and responses APIs return different parameter shapes.
    const params = bound.invocationParams() as { stop?: string[] };
    expect(params.stop).toEqual(["x"]);
  });

  /**
   * A literal `streaming: false` would set `disableStreaming`, which turns
   * every `.stream()` into one buffered `invoke` and kills the token feed.
   */
  it("streams, bound or not", () => {
    expect(model.disableStreaming).toBe(false);
    expect(asRedacting(model.bindTools([])).disableStreaming).toBe(false);
  });
});

/**
 * The gateway contract is `/chat/completions`. Spying on the facade's two
 * delegates shows which one a call lands on, without reaching the network.
 */
describe("the gateway route", () => {
  // `_modelPrefersResponsesAPI` claims any id containing `gpt-5.6`.
  const PREFERS_RESPONSES = "openai/gpt-5.6-mini";

  const routes = () => {
    const reply: ChatResult = {
      generations: [{ text: "ok", message: new AIMessage("ok") }],
    };
    return {
      completions: vi
        .spyOn(ChatOpenAICompletions.prototype, "_generate")
        .mockResolvedValue(reply),
      responses: vi
        .spyOn(ChatOpenAIResponses.prototype, "_generate")
        .mockResolvedValue(reply),
    };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The control: without it, a release that stops routing the id would leave
  // the two cases below passing while they prove nothing.
  it("is not where a plain ChatOpenAI sends the id", async () => {
    const { completions, responses } = routes();
    const plain = new ChatOpenAI({ model: PREFERS_RESPONSES, apiKey: "none" });

    await plain.invoke("hi");

    expect(responses).toHaveBeenCalledOnce();
    expect(completions).not.toHaveBeenCalled();
  });

  it.each([
    [
      "redacting",
      new RedactingChatOpenAI(
        { model: PREFERS_RESPONSES, apiKey: "none" },
        () => Promise.resolve(createRedactor(VOCAB)),
      ),
    ],
    [
      "plain",
      chatModel({ ...GATEWAY, model: PREFERS_RESPONSES, redact: false }),
    ],
  ])(
    "holds the %s model on chat completions with tools bound",
    async (_kind, model) => {
      const { completions, responses } = routes();

      await model.bindTools([]).invoke("hi");

      expect(completions).toHaveBeenCalledOnce();
      expect(responses).not.toHaveBeenCalled();
    },
  );
});

/**
 * The seam that actually matters: what crosses into `super` and what comes back
 * out to a run manager. Spying on `ChatOpenAI.prototype` intercepts the very
 * `super.*` calls the overrides make, so the provider is never reached.
 */
describe("the wire seam", () => {
  const redactor = createRedactor(VOCAB);
  const token = redactor.redactText(ACCOUNT);

  const model = new RedactingChatOpenAI(
    { model: "probe", apiKey: "none" },
    () => Promise.resolve(redactor),
  );

  const prompt = [
    new SystemMessage(`You are ${USER}'s CFO.`),
    new HumanMessage(`What is in ${ACCOUNT}?`),
  ];

  const options = {} as Parameters<RedactingChatOpenAI["_generate"]>[1];

  const spyManager = () => {
    const seen: string[] = [];
    const runManager = {
      handleLLMNewToken: (text: string) => {
        seen.push(text);
        return Promise.resolve();
      },
    } as unknown as CallbackManagerForLLMRun;
    return { seen, runManager };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands super placeholders, never vocabulary values", async () => {
    const crossed: BaseMessage[] = [];
    vi.spyOn(ChatOpenAI.prototype, "_generate").mockImplementation(
      (messages: BaseMessage[]): Promise<ChatResult> => {
        crossed.push(...messages);
        return Promise.resolve({
          generations: [
            {
              text: `Your ${token}.`,
              message: new AIMessage(`Your ${token}.`),
            },
          ],
        });
      },
    );

    const result = await model._generate(prompt, options);
    const outbound = crossed.map((message) => message.text).join("\n");

    expect(crossed).toHaveLength(2);
    expect(outbound).not.toContain(ACCOUNT);
    expect(outbound).not.toContain(USER);
    expect(outbound).toContain(token);
    expect(result.generations[0]?.text).toBe(`Your ${ACCOUNT}.`);
    expect(result.generations[0]?.message.text).toBe(`Your ${ACCOUNT}.`);
  });

  it("reports only restored text to the run manager", async () => {
    // The placeholder is split across deltas, and the stream stops partway
    // through a second one so a remainder is left in the stitcher.
    const deltas = [
      `Your ${token.slice(0, 5)}`,
      `${token.slice(5)} holds 85,000.50. ⟦A-12`,
    ];
    const crossed: BaseMessage[] = [];
    let handedDown: CallbackManagerForLLMRun | undefined;
    vi.spyOn(ChatOpenAI.prototype, "_streamResponseChunks").mockImplementation(
      async function* (
        messages: BaseMessage[],
        _options: unknown,
        inner?: CallbackManagerForLLMRun,
      ) {
        crossed.push(...messages);
        handedDown = inner;
        for (const delta of deltas) {
          const chunk = new ChatGenerationChunk({
            text: delta,
            message: new AIMessageChunk({ content: delta }),
          });
          yield chunk;
          // What the real provider does from inside its own generator, with
          // the raw chunk (chat_models/completions.js:232).
          await inner?.handleLLMNewToken(
            chunk.text,
            { prompt: 0, completion: 0 },
            undefined,
            undefined,
            undefined,
            { chunk },
          );
        }
      },
    );

    const { seen, runManager } = spyManager();
    const yielded: string[] = [];
    for await (const chunk of model._streamResponseChunks(
      prompt,
      options,
      runManager,
    )) {
      yielded.push(chunk.text);
    }

    expect(crossed.map((message) => message.text).join("\n")).not.toContain(
      ACCOUNT,
    );
    expect(handedDown).toBeUndefined();
    expect(seen).toEqual(yielded);
    expect(seen.join("")).toContain(`Your ${ACCOUNT} holds 85,000.50.`);
    expect(seen.join("")).not.toContain(token);
  });

  it("flushes a remainder the stitcher still holds at stream end", async () => {
    vi.spyOn(ChatOpenAI.prototype, "_streamResponseChunks").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/require-await
      async function* () {
        yield new ChatGenerationChunk({
          text: "balance ⟦A-12",
          message: new AIMessageChunk({ content: "balance ⟦A-12" }),
        });
      },
    );

    const { seen, runManager } = spyManager();
    const yielded: string[] = [];
    for await (const chunk of model._streamResponseChunks(
      prompt,
      options,
      runManager,
    )) {
      yielded.push(chunk.text);
    }

    expect(yielded).toEqual(["balance ", "⟦A-12"]);
    expect(seen).toEqual(["balance ", "⟦A-12"]);
  });
});
