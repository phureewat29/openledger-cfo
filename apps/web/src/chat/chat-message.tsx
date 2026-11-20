"use client";

import type { UIMessage } from "ai";
import { memo, Suspense } from "react";
import dynamic from "next/dynamic";
import { uniqBy } from "es-toolkit";

import { AssistantMessage, UserMessage } from "./message";

/** Markdown from the model is styled here rather than via a typography plugin. */
const MARKDOWN = [
  "min-w-0 text-sm leading-relaxed",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_p]:my-3",
  "[&_strong]:font-medium [&_strong]:text-foreground",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1",
  // One step per level, ending on the body size: a heading that matched the one
  // above it stopped saying which level it was.
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-medium",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[15px] [&_h2]:font-medium",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-medium",
  // The chip is for inline code: a fenced block's lines are blocks inside its
  // <code>, which turn the padded ends into empty lines of their own.
  "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-secondary [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_a]:underline [&_a]:underline-offset-2",
  // The column is a few hundred pixels at most, so anything unwrappable
  // scrolls inside itself.
  "[&_pre]:overflow-x-auto [&_pre]:rounded-lg",
  "[&_[data-streamdown=code-block-actions]]:border-transparent",
  "[&_table]:my-3 [&_table]:w-full [&_table]:text-xs [&_td]:border-t [&_td]:border-border [&_td]:py-1.5 [&_th]:py-1.5 [&_th]:text-left",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
].join(" ");

// No `loading`: the Suspense boundary catches it and the answer's own text stands in.
const Markdown = dynamic(() => import("./markdown"));

// Keys are the cfo agent's tool names, the chat route's startIngestRun included.
const TOOL_NOTICE: Record<string, string> = {
  getReport: "Totalled the ledger",
  listTransactions: "Read the transactions",
  listAccounts: "Read the balances",
  matchAccounts: "Matched accounts",
  listFiles: "Read the files",
  createAccount: "Created an account",
  updateAccount: "Updated an account",
  mergeAccounts: "Merged two accounts",
  adjustBalance: "Adjusted a balance",
  deleteAccount: "Deleted an account",
  addTransaction: "Posted a transaction",
  updateTransaction: "Updated a transaction",
  deleteTransaction: "Deleted a transaction",
  recategorizeTransactions: "Moved a whole account's transactions",
  mergeTransactions: "Merged duplicates",
  dropFile: "Dropped a file's rows",
  startIngestRun: "Started an ingest run",
};

const TOOL_PREFIX = "tool-";

const commandOf = (part: unknown): string | undefined => {
  const output = (part as { output?: { command?: unknown } }).output;
  return typeof output?.command === "string" ? output.command : undefined;
};

const textOf = (message: UIMessage) =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

// The first tokens fetch the renderer; until it lands they read fine as plain text.
function Response({ children }: { children: string }) {
  return (
    <div className={MARKDOWN}>
      <Suspense fallback={<p className="whitespace-pre-wrap">{children}</p>}>
        <Markdown>{children}</Markdown>
      </Suspense>
    </div>
  );
}

function Message({ message, anchor }: { message: UIMessage; anchor: boolean }) {
  const text = textOf(message);
  if (message.role === "user") {
    return <UserMessage anchor={anchor}>{text}</UserMessage>;
  }

  const tools = uniqBy(
    message.parts
      .filter((part) => part.type.startsWith(TOOL_PREFIX))
      .map((part, index) => {
        const tool = part.type.slice(TOOL_PREFIX.length);
        const command = commandOf(part);
        return { tool, command, key: `${tool}:${command ?? index}` };
      }),
    (entry) => entry.key,
  );

  return (
    <AssistantMessage>
      {tools.map(({ tool, command, key }) => (
        <span
          key={key}
          className="border-border ml-2 flex flex-col gap-0.5 border-l pl-2"
        >
          <span className="text-muted-foreground text-[10px]">
            {TOOL_NOTICE[tool] ?? "Ran a ledger command"}
          </span>
          {command ? (
            <span
              className="text-muted-foreground truncate text-[10px]"
              title={command}
            >
              $ {command}
            </span>
          ) : null}
        </span>
      ))}
      {text.length > 0 ? <Response>{text}</Response> : null}
    </AssistantMessage>
  );
}

// Only the message still being written gets new parts; a settled one keeps its array.
export const ChatMessage = memo(
  Message,
  (previous, next) =>
    previous.anchor === next.anchor &&
    previous.message.id === next.message.id &&
    previous.message.parts === next.message.parts,
);
