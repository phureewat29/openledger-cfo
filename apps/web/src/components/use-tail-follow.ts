"use client";

import { useEffect, useRef } from "react";

/** Below this the reader is at the tail and new lines should follow. */
const STUCK_PX = 40;

/**
 * Keeps a log pinned to its newest line while the reader sits at the tail, and
 * lets go once they scroll up to read.
 */
export function useTailFollow(lines: readonly unknown[]) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Read only by the effect; a re-render per scroll event would buy nothing.
  const stuck = useRef(true);

  useEffect(() => {
    const element = ref.current;
    if (element === null || !stuck.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lines]);

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    stuck.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      STUCK_PX;
  };

  return { ref, onScroll };
}
