import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { describe, expect, it } from "vitest";

import type { VocabEntry } from "./redaction";
import { createRedactor, createStitcher } from "./redaction";

/** The shapes real data takes: the user's own labels, never an institution. */
const VOCAB: VocabEntry[] = [
  { category: "A", value: "KBank Wealth Current" },
  { category: "A", value: "KBank" },
  { category: "A", value: "Family House — Khon Kaen" },
  { category: "A", value: 'Somsak "Golf" Fund' },
  { category: "K", value: "****4417" },
  { category: "U", value: "ครัวซองต์ คอร์กี้" },
  { category: "F", value: "2026-01-kbank.pdf" },
];

const TOKEN_RE = /⟦[A-Z]-[0-9a-f]{8,16}⟧/gu;

const tokensIn = (text: string): string[] => text.match(TOKEN_RE) ?? [];

const redactor = createRedactor(VOCAB);

const PARAGRAPH = [
  "ครัวซองต์ คอร์กี้ moved 85,000.50 from KBank Wealth Current to Family House — Khon Kaen",
  "on 2026-01-01; the statement 2026-01-kbank.pdf lists ****4417 and account 123-4-56789-0,",
  "wired to 012345678901, receipt to somsak.golf@example.co.th.",
].join(" ");

const SENTENCE = "Move from KBank Wealth Current to Family House — Khon Kaen.";

const ARGUMENTS = JSON.stringify({
  description: "Transfer to Family House — Khon Kaen",
  amount: 120.5,
  date: "2026-01-15",
});

const parse = (text: string): Record<string, unknown> =>
  JSON.parse(text) as Record<string, unknown>;

describe("redactText", () => {
  it("round-trips a paragraph of mixed hits", () => {
    const redacted = redactor.redactText(PARAGRAPH);
    expect(redactor.restoreText(redacted)).toBe(PARAGRAPH);
    expect(tokensIn(redacted)).toHaveLength(8);
  });

  it.each([
    "ครัวซองต์ คอร์กี้",
    "KBank Wealth Current",
    "Family House — Khon Kaen",
    "2026-01-kbank.pdf",
    "****4417",
    "123-4-56789-0",
    "012345678901",
    "somsak.golf@example.co.th",
  ])("hides %s", (hidden) => {
    expect(redactor.redactText(PARAGRAPH)).not.toContain(hidden);
  });

  it("is idempotent", () => {
    const once = redactor.redactText(PARAGRAPH);
    expect(redactor.redactText(once)).toBe(once);
  });

  it("prefers the longest vocabulary match over a prefix of it", () => {
    const text = "KBank Wealth Current sits under KBank.";
    const redacted = redactor.redactText(text);
    const [first, second] = tokensIn(redacted);
    expect(tokensIn(redacted)).toHaveLength(2);
    expect(first).not.toBe(second);
    expect(redacted).not.toContain("KBank");
    expect(redactor.restoreText(redacted)).toBe(text);
  });

  it("is deterministic across independent redactors", () => {
    expect(createRedactor(VOCAB).redactText(PARAGRAPH)).toBe(
      createRedactor(VOCAB).redactText(PARAGRAPH),
    );
  });

  it.each([
    "2026-01-01",
    "85,000.50",
    "thb:asset:bank:kbank",
    "1,250,000.00",
    "2026-08-20T10:00",
    "Coffee at Starbucks",
    '{"description":"Coffee at Starbucks via Kasikornbank"}',
  ])("leaves %s alone", (value) => {
    expect(redactor.redactText(value)).toBe(value);
  });
});

describe("restoreText", () => {
  it("leaves a placeholder it never issued verbatim", () => {
    expect(redactor.restoreText("⟦A-deadbeef⟧")).toBe("⟦A-deadbeef⟧");
  });
});

describe("restoreJsonFragment", () => {
  it("escapes an original so it survives inside a JSON string literal", () => {
    const fragment = redactor.restoreJsonFragment(
      redactor.redactText('Somsak "Golf" Fund'),
    );
    expect(parse(`{"name":"${fragment}"}`).name).toBe('Somsak "Golf" Fund');
  });
});

describe("createStitcher", () => {
  const redacted = redactor.redactText(SENTENCE);
  const whole = redactor.restoreText(redacted);

  const stitch = (pieces: string[]): string => {
    const stitcher = createStitcher(redactor.restoreText);
    return (
      pieces.map((piece) => stitcher.push(piece)).join("") + stitcher.flush()
    );
  };

  it("has two placeholders to cut through", () => {
    expect(tokensIn(redacted)).toHaveLength(2);
  });

  it("restores across every two-way split", () => {
    const cuts = [...Array(redacted.length + 1).keys()];
    const failures = cuts.filter(
      (cut) => stitch([redacted.slice(0, cut), redacted.slice(cut)]) !== whole,
    );
    expect(failures).toEqual([]);
  });

  it("restores across every three-way split", () => {
    const cuts = [...Array(redacted.length + 1).keys()];
    const failures = cuts.flatMap((first) =>
      cuts
        .filter((second) => second >= first)
        .filter(
          (second) =>
            stitch([
              redacted.slice(0, first),
              redacted.slice(first, second),
              redacted.slice(second),
            ]) !== whole,
        )
        .map((second) => `${String(first)}/${String(second)}`),
    );
    expect(failures).toEqual([]);
  });

  it("holds back a placeholder in the making and flushes it verbatim", () => {
    const stitcher = createStitcher(redactor.restoreText);
    expect(stitcher.push("balance ") + stitcher.push("⟦A-12")).toBe("balance ");
    expect(stitcher.flush()).toBe("⟦A-12");
  });
});

describe("redactMessage", () => {
  const original = new AIMessage({
    id: "msg_1",
    content: "Moving money out of KBank Wealth Current",
    tool_calls: [
      {
        id: "call_1",
        name: "transfer",
        args: {
          from: "KBank Wealth Current",
          to: "Family House — Khon Kaen",
          amount: 1200,
        },
      },
    ],
    additional_kwargs: {
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "transfer", arguments: ARGUMENTS },
        },
      ],
    },
    usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });

  const snapshot = (message: AIMessage): string =>
    JSON.stringify({
      content: message.content,
      tool_calls: message.tool_calls,
      additional_kwargs: message.additional_kwargs,
    });

  it("never mutates the message it was given", () => {
    const before = snapshot(original);
    const redacted = redactor.redactMessage(original);
    expect(snapshot(original)).toBe(before);
    expect(redacted).not.toBe(original);
    expect(redacted).toBeInstanceOf(AIMessage);
  });

  it("keeps identity and usage metadata", () => {
    const redacted = redactor.redactMessage(original) as AIMessage;
    expect(redacted.id).toBe("msg_1");
    expect(redacted.usage_metadata?.total_tokens).toBe(15);
  });

  it("hides content and string tool arguments, leaving numbers alone", () => {
    const redacted = redactor.redactMessage(original) as AIMessage;
    const args = redacted.tool_calls?.[0]?.args ?? {};
    expect(redacted.text).not.toContain("KBank Wealth Current");
    expect(Object.keys(args)).toEqual(["from", "to", "amount"]);
    expect(args.amount).toBe(1200);
    expect(tokensIn(String(args.from))).toHaveLength(1);
  });

  it("walks raw tool-call arguments as JSON", () => {
    const redacted = redactor.redactMessage(original) as AIMessage;
    const parsed = parse(
      redacted.additional_kwargs.tool_calls?.[0]?.function.arguments ?? "",
    );
    expect(Object.keys(parsed)).toEqual(["description", "amount", "date"]);
    expect(parsed.amount).toBe(120.5);
    expect(parsed.date).toBe("2026-01-15");
    expect(tokensIn(String(parsed.description))).toHaveLength(1);
  });

  it("redacts a tool result but never its artifact", () => {
    const tool = new ToolMessage({
      content: JSON.stringify({
        account: "KBank Wealth Current",
        masked: "****4417",
        balance: "85,000.50",
      }),
      tool_call_id: "call_1",
      artifact: { rows: [{ account: "KBank Wealth Current" }] },
    });
    const redacted = redactor.redactMessage(tool) as ToolMessage;
    const payload = parse(redacted.text);
    expect(Object.keys(payload)).toEqual(["account", "masked", "balance"]);
    expect(tokensIn(String(payload.account))).toHaveLength(1);
    expect(tokensIn(String(payload.masked))).toHaveLength(1);
    expect(payload.balance).toBe("85,000.50");
    expect(redacted.artifact).toBe(tool.artifact);
  });

  it("redacts text blocks and leaves other blocks untouched", () => {
    const image = {
      type: "image_url",
      image_url: { url: "https://example.com/a.png" },
    };
    const redacted = redactor.redactMessage(
      new HumanMessage({
        content: [
          { type: "text", text: "Show ครัวซองต์ คอร์กี้ the balance" },
          image,
        ],
      }),
    );
    const parts = redacted.content as Record<string, unknown>[];
    expect(tokensIn(String(parts[0]?.text))).toHaveLength(1);
    expect(parts[1]).toEqual(image);
  });
});

describe("restoreResult", () => {
  it("restores text, content, tool arguments and keeps metadata", () => {
    const redacted = redactor.redactMessage(
      new AIMessage({
        content: "Moving money out of KBank Wealth Current",
        tool_calls: [
          {
            id: "call_1",
            name: "transfer",
            args: { from: "KBank Wealth Current" },
          },
        ],
        additional_kwargs: {
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "transfer", arguments: ARGUMENTS },
            },
          ],
        },
      }),
    ) as AIMessage;

    const result = redactor.restoreResult({
      generations: [
        {
          text: redacted.text,
          message: redacted,
          generationInfo: { finish_reason: "tool_calls" },
        },
      ],
      llmOutput: { model_name: "probe" },
    });
    const generation = result.generations[0];
    const message = generation?.message as AIMessage;

    expect(generation?.text).toBe("Moving money out of KBank Wealth Current");
    expect(message.text).toBe("Moving money out of KBank Wealth Current");
    expect(message.tool_calls?.[0]?.args.from).toBe("KBank Wealth Current");
    expect(message.additional_kwargs.tool_calls?.[0]?.function.arguments).toBe(
      ARGUMENTS,
    );
    expect(result.llmOutput?.model_name).toBe("probe");
    expect(generation?.generationInfo?.finish_reason).toBe("tool_calls");
  });
});

describe("chunkRestorer", () => {
  const argsChunk = (args: string, opening: boolean): ChatGenerationChunk =>
    new ChatGenerationChunk({
      text: "",
      message: new AIMessageChunk({
        id: "chunk_1",
        content: "",
        usage_metadata: opening
          ? { input_tokens: 3, output_tokens: 4, total_tokens: 7 }
          : undefined,
        tool_call_chunks: [
          {
            index: 0,
            id: opening ? "call_1" : undefined,
            name: opening ? "read_account" : undefined,
            args,
            type: "tool_call_chunk",
          },
        ],
      }),
    });

  it("reassembles tool arguments split mid-placeholder", () => {
    const wire = `{"account":"${redactor.redactText('Somsak "Golf" Fund')}"}`;
    const cuts = [wire.indexOf("⟦") + 4, wire.indexOf("⟧") - 2];
    const restorer = redactor.chunkRestorer();
    const streamed = [
      wire.slice(0, cuts[0]),
      wire.slice(cuts[0], cuts[1]),
      wire.slice(cuts[1]),
    ].map((piece, position) => restorer.push(argsChunk(piece, position === 0)));

    const args = streamed
      .map(
        (chunk) =>
          (chunk.message as AIMessageChunk).tool_call_chunks?.[0]?.args ?? "",
      )
      .join("");

    expect(parse(args).account).toBe('Somsak "Golf" Fund');
    expect(restorer.flush()).toBeUndefined();
    expect(streamed[0]?.message.id).toBe("chunk_1");
    expect((streamed[0]?.message as AIMessageChunk).usage_metadata).toEqual({
      input_tokens: 3,
      output_tokens: 4,
      total_tokens: 7,
    });
    expect(
      (streamed[0]?.message as AIMessageChunk).tool_call_chunks?.[0]?.name,
    ).toBe("read_account");
  });

  it("drops the raw fragments the converter duplicates into kwargs", () => {
    const token = redactor.redactText('Somsak "Golf" Fund');
    const wire = `{"account":"${token}"}`;
    const restored = redactor.chunkRestorer().push(
      new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({
          content: "",
          additional_kwargs: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "read_account", arguments: wire },
              },
            ],
          },
          tool_call_chunks: [
            {
              index: 0,
              id: "call_1",
              name: "read_account",
              args: wire,
              type: "tool_call_chunk",
            },
          ],
        }),
      }),
    );
    const message = restored.message as AIMessageChunk;

    expect(message.additional_kwargs.tool_calls).toBeUndefined();
    expect(JSON.stringify(message.additional_kwargs)).not.toContain("\u27e6");
    expect(message.tool_call_chunks?.[0]?.args).toContain('Somsak \\"Golf');
  });

  it("restores text deltas split mid-placeholder", () => {
    const redacted = redactor.redactText(SENTENCE);
    const restorer = redactor.chunkRestorer();
    const splits = [redacted.indexOf("⟦") + 3, redacted.lastIndexOf("⟦") + 5];
    const out = [
      redacted.slice(0, splits[0]),
      redacted.slice(splits[0], splits[1]),
      redacted.slice(splits[1]),
    ]
      .map((delta) =>
        restorer.push(
          new ChatGenerationChunk({
            text: delta,
            message: new AIMessageChunk({ content: delta }),
          }),
        ),
      )
      .map((chunk) => chunk.text)
      .join("");

    expect(out + (restorer.flush()?.text ?? "")).toBe(SENTENCE);
  });

  it("flushes a stream cut mid-placeholder verbatim", () => {
    const restorer = redactor.chunkRestorer();
    restorer.push(
      new ChatGenerationChunk({
        text: "balance ⟦A-12",
        message: new AIMessageChunk({ content: "balance ⟦A-12" }),
      }),
    );
    expect(restorer.flush()?.text).toBe("⟦A-12");
  });
});
