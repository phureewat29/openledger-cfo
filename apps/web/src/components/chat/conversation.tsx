"use client";

import { useCallback, useEffect, useRef } from "react";

import { cn } from "@openledger-cfo/ui";

/** Within this of the end, the reader is at the tail and new content follows. */
const STUCK_PX = 40;
/** What a turn must still leave clear before the question is pinned instead. */
const GAP = 24;
/** The pinned question sits just off the top edge rather than against it. */
const PIN_OFFSET = 8;

export function Conversation({
  children,
  turnKey,
  className,
}: {
  children: React.ReactNode;
  /** The newest question; a different one starts the turn over. */
  turnKey: string | undefined;
  className?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  /** The reader is at the tail; false once they scroll away from it. */
  const attached = useRef(true);
  /** The turn whose question has already been pinned, so it happens once. */
  const pinned = useRef<string | undefined>(undefined);
  /** A scroll of ours is pending; the event it raises is not the reader's. */
  const scripted = useRef(false);

  /**
   * Instant, never animated: an animation would race content that grows
   * every frame. The flag keeps the scroll handler below from mistaking this
   * for the reader scrolling away — more tokens land before the event fires.
   */
  const scrollTo = useCallback((view: HTMLDivElement, top: number) => {
    const limit = view.scrollHeight - view.clientHeight;
    const target = Math.max(0, Math.min(top, limit));
    if (Math.abs(target - view.scrollTop) < 1) return;
    scripted.current = true;
    view.scrollTop = target;
  }, []);

  const follow = useCallback(() => {
    const view = viewport.current;
    if (view === null || !attached.current) return;

    const anchor = view.querySelector<HTMLElement>("[data-turn-anchor]");
    const turn = anchor === null ? 0 : view.scrollHeight - anchor.offsetTop;
    if (
      anchor === null ||
      turn <= view.clientHeight - GAP ||
      pinned.current === turnKey
    ) {
      scrollTo(view, view.scrollHeight);
      return;
    }

    // The answer outgrew the frame: the question goes to the top and stays
    // there, so the reader reads down it rather than chasing the last line.
    pinned.current = turnKey;
    attached.current = false;
    scrollTo(view, anchor.offsetTop - PIN_OFFSET);
  }, [scrollTo, turnKey]);

  useEffect(() => {
    const view = viewport.current;
    if (view === null) return;
    attached.current = true;
    pinned.current = undefined;
    scrollTo(view, view.scrollHeight);
  }, [scrollTo, turnKey]);

  useEffect(() => {
    const inner = content.current;
    if (inner === null) return;
    const observer = new ResizeObserver(follow);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [follow]);

  return (
    <div
      ref={viewport}
      onScroll={(event) => {
        if (scripted.current) {
          scripted.current = false;
          return;
        }
        const view = event.currentTarget;
        attached.current =
          view.scrollHeight - view.scrollTop - view.clientHeight <= STUCK_PX;
      }}
      /* The browser's own anchoring fights every scroll above for the same
         pixels, and `offsetTop` is only measurable against a positioned box. */
      className={cn(
        "relative overflow-y-auto [overflow-anchor:none]",
        className,
      )}
    >
      <div ref={content} className="flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}
