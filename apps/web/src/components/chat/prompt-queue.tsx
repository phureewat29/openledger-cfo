"use client";

import { useEffect, useState } from "react";
import { head, tail } from "es-toolkit";

import { RemoveButton } from "~/components/plan/remove-button";

export interface Prompt {
  readonly id: string;
  readonly text: string;
  /** The route the question was asked from, not the one it may land on. */
  readonly path: string;
}

/**
 * All the queue asks of the chat, and narrower than `sendMessage`'s own
 * signature on purpose: which message type the pane keeps its transcript in is
 * none of the queue's business, and naming it here would tie the two together.
 */
type Send = (
  message: { text: string },
  options: { body: { context: { path: string } } },
) => Promise<void>;

interface Queue {
  /** Handed to the chat; the run it started has not settled yet. */
  readonly sending: Prompt | undefined;
  readonly waiting: readonly Prompt[];
  readonly seq: number;
}

const EMPTY: Queue = { sending: undefined, waiting: [], seq: 0 };

const enqueue = (state: Queue, text: string, path: string): Queue => {
  const prompt = { id: String(state.seq), text, path };
  const seq = state.seq + 1;
  return state.sending === undefined
    ? { ...state, sending: prompt, seq }
    : { ...state, waiting: [...state.waiting, prompt], seq };
};

const remove = (state: Queue, id: string): Queue => ({
  ...state,
  waiting: state.waiting.filter((prompt) => prompt.id !== id),
});

const advance = (state: Queue): Queue => ({
  ...state,
  sending: head(state.waiting),
  waiting: tail(state.waiting),
});

/**
 * A second `sendMessage` during a live run neither queues nor aborts: the chat
 * swaps in a fresh active response while the first stream keeps writing into a
 * message list the second one now owns. So one prompt is out at a time and the
 * rest wait here, each still withdrawable, until the run settles.
 */
export function usePromptQueue(send: Send) {
  const [queue, setQueue] = useState(EMPTY);
  const { sending } = queue;

  useEffect(() => {
    if (sending === undefined) return;
    // The promise settles when the run ends — answered, stopped, or errored.
    const settle = () => setQueue(advance);
    void send(
      { text: sending.text },
      { body: { context: { path: sending.path } } },
    ).then(settle, settle);
  }, [sending, send]);

  return {
    sending,
    waiting: queue.waiting,
    ask: (text: string, path: string) =>
      setQueue((state) => enqueue(state, text, path)),
    drop: (id: string) => setQueue((state) => remove(state, id)),
  };
}

export function QueuedPrompts({
  items,
  onRemove,
}: {
  items: readonly Prompt[];
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <ul aria-label="Queued messages" className="flex flex-col gap-1">
      {items.map((prompt) => (
        <li
          key={prompt.id}
          className="border-border bg-secondary text-muted-foreground flex items-center gap-1.5 rounded-sm border py-0.5 pr-0.5 pl-2 text-[11px]"
        >
          <span aria-hidden className="shrink-0 text-[10px]">
            ›
          </span>
          <span className="min-w-0 flex-1 truncate">{prompt.text}</span>
          <RemoveButton
            label={`Remove queued message: ${prompt.text}`}
            disabled={false}
            onClick={() => onRemove(prompt.id)}
            className="size-5 shrink-0"
          />
        </li>
      ))}
    </ul>
  );
}
