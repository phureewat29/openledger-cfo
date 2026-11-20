"use client";

import { useSyncExternalStore } from "react";
import { noop } from "es-toolkit";

// Nothing to subscribe to: the value flips once, when React finishes hydrating.
const subscribe = () => noop;

// False through the server render and the hydration pass, true right after.
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
