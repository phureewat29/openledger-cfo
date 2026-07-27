"use client";

import { useSyncExternalStore } from "react";

// Nothing to subscribe to: the value flips once, when React finishes hydrating.
const unsubscribe = () => undefined;
const subscribe = () => unsubscribe;

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
