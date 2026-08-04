"use client";

import type { UIMessage } from "ai";
import { memo } from "react";

import {
  AssistantMessage,
  CommandNotice,
  ToolGroup,
  ToolNotice,
  UserMessage,
} from "./message";
import { Response } from "./response";

// Keys are the tool names in packages/agent/src/registry.ts (cfo entry).
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
  dropFile: "Dropped a statement's rows",
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

function Message({ message, anchor }: { message: UIMessage; anchor: boolean }) {
  const text = textOf(message);
  if (message.role === "user") {
    return <UserMessage anchor={anchor}>{text}</UserMessage>;
  }

  const seen = new Set<string>();
  return (
    <AssistantMessage>
      {message.parts
        .filter((part) => part.type.startsWith(TOOL_PREFIX))
        .map((part, index) => {
          const tool = part.type.slice(TOOL_PREFIX.length);
          const command = commandOf(part);
          const key = `${tool}:${command ?? index}`;
          if (seen.has(key)) return null;
          seen.add(key);
          return (
            <ToolGroup key={key}>
              <ToolNotice>
                {TOOL_NOTICE[tool] ?? "Ran a ledger command"}
              </ToolNotice>
              {command ? <CommandNotice command={command} /> : null}
            </ToolGroup>
          );
        })}
      {text.length > 0 ? <Response>{text}</Response> : null}
    </AssistantMessage>
  );
}

/**
 * The pane re-renders on every route change, and only the message still being
 * written has anything new in it: its parts are replaced per token while a
 * settled message keeps the array it was finished with.
 */
export const ChatMessage = memo(
  Message,
  (previous, next) =>
    previous.anchor === next.anchor &&
    previous.message.id === next.message.id &&
    previous.message.parts === next.message.parts,
);
