"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { Settings } from "lucide-react";

import { Button } from "@openledger-cfo/ui/button";

import type { CfoChatMessage } from "./suggestions";
import { useConfigDialog } from "~/components/config/config-dialog-provider";
import { SETTINGS_TRIGGER_ID } from "~/components/config/focus";
import { ModelChip } from "~/components/config/model-chip";
import { OlLogo } from "~/components/logo";
import { ChatMessage } from "./chat-message";
import { Conversation } from "./conversation";
import { useChatDock } from "./dock";
import { Greeting } from "./greeting";
import { Thinking } from "./message";
import { PromptInput } from "./prompt-input";
import { QueuedPrompts, usePromptQueue } from "./prompt-queue";

const PLACEHOLDER = "Talk to your money";

export function ChatPane({
  ledgerOk,
  ai,
  openers,
}: {
  ledgerOk: boolean;
  /** Absent means no gateway is configured; only the model crosses to the client. */
  ai?: { model: string };
  openers: readonly string[];
}) {
  const [input, setInput] = useState("");
  const pathname = usePathname();
  const dock = useChatDock();
  const config = useConfigDialog();
  const { messages, sendMessage, stop, status, error } =
    useChat<CfoChatMessage>();
  const queue = usePromptQueue(sendMessage);
  const busy = status === "submitted" || status === "streaming";
  const turnKey = messages.findLast((message) => message.role === "user")?.id;
  const aiConfigured = ai !== undefined;
  const enabled = ledgerOk && aiConfigured;

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
    queue.ask(text, pathname);
  };

  const body = () => {
    if (!ledgerOk) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <p className="text-muted-foreground text-xs">
            The ledger comes first. CFO wakes once it answers.
          </p>
        </div>
      );
    }
    if (!aiConfigured) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-3">
          <div className="flex max-w-[16rem] flex-col items-center gap-3 text-center">
            <p className="text-[13px]">CFO is asleep.</p>
            <p className="text-muted-foreground text-xs">
              Configure an AI gateway to wake it up. Everything else works
              without one.
            </p>
            <Button variant="outline" size="sm" onClick={config.open}>
              AI Gateway Configuration
            </Button>
          </div>
        </div>
      );
    }
    if (messages.length === 0) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-3">
          <p className="text-muted-foreground text-center text-[13px] leading-8">
            <Greeting />
          </p>
        </div>
      );
    }
    return (
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
    );
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
          <span className="flex max-w-[55%] min-w-0 items-center gap-2">
            <ModelChip
              configured={aiConfigured}
              model={ai?.model ?? ""}
              ledgerOk={ledgerOk}
            />
            <button
              type="button"
              id={SETTINGS_TRIGGER_ID}
              aria-label="Setup"
              onClick={config.open}
              className="text-muted-foreground hover:text-foreground focus-visible:outline-ring shrink-0 cursor-pointer outline-none focus-visible:outline-2"
            >
              <Settings size={13} strokeWidth={1.75} aria-hidden />
            </button>
          </span>
        </header>

        {body()}

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
