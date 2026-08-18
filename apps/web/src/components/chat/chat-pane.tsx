"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useChat } from "@ai-sdk/react";

import {
  DEFAULT_MODEL,
  RECOMMENDED_MODELS,
} from "@openledger-cfo/agent/catalog";

import type { CfoChatMessage } from "./suggestions";
import { OlLogo } from "~/components/logo";
import { ChatMessage } from "./chat-message";
import { Conversation } from "./conversation";
import { useChatDock } from "./dock";
import { Greeting } from "./greeting";
import { Thinking } from "./message";
import { ModelDialog } from "./model-dialog";
import { PromptInput } from "./prompt-input";
import { QueuedPrompts, usePromptQueue } from "./prompt-queue";

const PLACEHOLDER = "Talk to your money";

export function ChatPane({
  enabled,
  openers,
}: {
  enabled: boolean;
  openers: readonly string[];
}) {
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [picking, setPicking] = useState(false);
  const pathname = usePathname();
  const dock = useChatDock();
  const { messages, sendMessage, stop, status, error } =
    useChat<CfoChatMessage>();
  const queue = usePromptQueue(sendMessage);
  const busy = status === "submitted" || status === "streaming";
  const turnKey = messages.findLast((message) => message.role === "user")?.id;

  // Offer the next question only between turns. A prompt still queued means the
  // user has already moved past whatever the last answer suggested, and the
  // queue holds one past the run that settles it — hence both halves.
  const idle = status === "ready" && queue.sending === undefined;
  const last = messages.at(-1);
  const followUps =
    last?.role === "assistant"
      ? (last.parts.find((part) => part.type === "data-suggestions")?.data ??
        [])
      : [];
  const opening = messages.length === 0;
  const offered = opening ? openers : followUps;

  const ask = (text: string) => {
    if (text.trim().length === 0) return;
    queue.ask(text, pathname, model);
  };

  return (
    <>
      {dock.open ? (
        <button
          type="button"
          aria-label="Close chat"
          onClick={() => dock.setOpen(false)}
          className="bg-background/60 fixed inset-0 z-30 lg:hidden"
        />
      ) : null}

      <div
        data-open={dock.open}
        className="border-border bg-background flex h-full min-h-0 flex-col border-l max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[min(420px,100vw)] max-lg:translate-x-full max-lg:transition-transform max-lg:data-[open=true]:translate-x-0"
      >
        <header className="border-border flex h-8 shrink-0 items-center justify-between gap-3 border-b px-3">
          <span className="flex items-center gap-2">
            <OlLogo size={14} className="shrink-0" />
            <span className="label">CFO</span>
          </span>
          {enabled ? (
            <button
              type="button"
              aria-label="Model"
              onClick={() => setPicking(true)}
              className="text-muted-foreground hover:text-foreground focus-visible:outline-ring max-w-[45%] shrink cursor-pointer truncate bg-transparent text-right text-[10px] tracking-[0.12em] uppercase outline-none focus-visible:outline-2"
            >
              {RECOMMENDED_MODELS.find((choice) => choice.id === model)
                ?.label ?? model}
            </button>
          ) : (
            <span className="border-border text-muted-foreground shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] tracking-[0.12em] uppercase">
              No key
            </span>
          )}
        </header>

        <ModelDialog
          open={picking}
          current={model}
          onPick={(id) => {
            setModel(id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />

        {!enabled ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <p className="text-muted-foreground text-xs">
              Set{" "}
              <code className="text-foreground">
                OPENAI_COMPATIBLE_BASE_URL
              </code>{" "}
              and{" "}
              <code className="text-foreground">OPENAI_COMPATIBLE_API_KEY</code>{" "}
              in <code className="text-foreground">.env</code> to wake CFO.
              Every pane is computed from the ledger by rules, so nothing else
              waits on it.
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-3">
            <p className="text-muted-foreground text-center text-[13px] leading-8">
              <Greeting />
            </p>
          </div>
        ) : (
          <Conversation turnKey={turnKey} className="min-h-0 flex-1 px-3 py-3">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                anchor={message.id === turnKey}
              />
            ))}
            {status === "submitted" ? <Thinking /> : null}
          </Conversation>
        )}

        {error ? (
          <p className="text-destructive shrink-0 px-3 pb-2 text-xs">
            {error.message}
          </p>
        ) : null}

        {enabled && idle && offered.length > 0 ? (
          <div
            role="group"
            aria-labelledby="offered-label"
            className="border-border flex shrink-0 flex-col items-stretch gap-0 border-t px-3 py-2"
          >
            <span id="offered-label" className="label h-5 leading-5">
              {opening ? "Try" : "Ask next"}
            </span>
            {offered.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => ask(suggestion)}
                className="hover:text-accent text-muted-foreground flex h-7 cursor-pointer items-center gap-1.5 text-left text-xs max-lg:h-9"
              >
                <span aria-hidden className="shrink-0">
                  ›
                </span>
                <span className="min-w-0 flex-1 truncate">{suggestion}</span>
              </button>
            ))}
          </div>
        ) : null}

        {enabled ? (
          <div className="border-border flex shrink-0 flex-col gap-2 border-t p-2">
            <QueuedPrompts items={queue.waiting} onRemove={queue.drop} />
            <PromptInput
              value={input}
              onValueChange={setInput}
              onSubmit={() => {
                ask(input);
                setInput("");
              }}
              busy={busy}
              onStop={stop}
              placeholder={PLACEHOLDER}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
