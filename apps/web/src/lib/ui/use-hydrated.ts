"use client";

import { useSyncExternalStore } from "react";
import { noop } from "es-toolkit";

// Nothing to subscribe to: the value flips once, when React finishes hydrating.
const subscribe = () => noop;

/**
 * False through the server render and the hydration pass, true immediately
 * after: a pane whose shared query can resolve before its own subtree
 * hydrates would otherwise render a different first tree than the HTML
 * being hydrated.
 */
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
