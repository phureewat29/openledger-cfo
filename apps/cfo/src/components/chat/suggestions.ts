"use client";

import type { UIMessage } from "ai";
import { useSyncExternalStore } from "react";
import { sampleSize } from "es-toolkit";

/**
 * The transcript's message shape. The stream appends the follow-up chips it
 * generated as a `data-suggestions` part, so they ride along with the answer
 * they belong to and survive a route change like any other part.
 */
export type CfoChatMessage = UIMessage<unknown, { suggestions: string[] }>;

const PICK_COUNT = 4;

/**
 * Openers for an empty pane. Every one has to be answerable from the briefing
 * or a tool the CFO agent actually holds — nothing about budgets or reminders,
 * which live in the control plane and not in its hands. Short enough to read
 * whole at the pane's narrowest, and phrased as an ask rather than a question
 * so the strip stays quiet.
 */
export const SUGGESTION_POOL: readonly string[] = [
  "How am I doing this month",
  "Where is the money going",
  "What should I cut",
  "Am I on track for my goals",

  "What changed since last month",
  "My biggest expense this month",
  "Did I overspend this month",
  "How much did I earn this month",

  "Top merchants this quarter",
  "What does food cost me monthly",
  "Where did the most money go",
  "Break down my spending by account",
  "What do I spend on transport",

  "Find subscriptions I forgot about",
  "Which recurring charges grew",
  "Show me my largest transactions",
  "Which category grew the fastest",
  "What is my most wasteful habit",

  "How long does my cash last",
  "Is my cash buffer healthy",
  "How much cash do I have",
  "What happens if income stops",

  "What is my savings rate",
  "Am I saving enough",
  "How much did I save this year",
  "Is my savings rate improving",

  "Which goal needs attention first",
  "What is blocking my goals",
  "How much more for my goal",
  "Should I move a goal deadline",

  "What is my net worth",
  "Which account grew most this year",
  "How are my USD holdings doing",
  "List all my accounts",
  "Which account is bleeding money",

  "Project this month's spending",
  "Compare this year to last year",
  "What is my spending trend",
  "How does this month compare",
  "Where am I heading this quarter",

  "Find duplicate transactions",
  "Check for uncategorized spending",
  "Reconcile my main bank balance",
  "Which statements have I imported",
  "Clean up my account names",

  "Can I afford a big trip",
  "Should I pay down debt first",
  "Can I afford to invest more",
  "What would cutting dining save",
  "Is now a good time to spend",
];

/** The server and the hydration render must agree, so the opening four are fixed. */
const OPENING: readonly string[] = SUGGESTION_POOL.slice(0, PICK_COUNT);

/**
 * One draw per page load, held outside React. Drawing during a render would
 * give the server and the browser different answers and lose the hydration; a
 * store React subscribes to is the sanctioned way to hold something the server
 * cannot know. Both snapshots are stable references, which is what the hook
 * asks for.
 */
let drawn: readonly string[] | null = null;

const subscribe = (changed: () => void) => {
  if (drawn === null) {
    drawn = sampleSize(SUGGESTION_POOL, PICK_COUNT);
    changed();
  }
  return () => undefined;
};

const drawnOrOpening = (): readonly string[] => drawn ?? OPENING;
const opening = (): readonly string[] => OPENING;

/** Four openers: the fixed set until the page is live, a random draw after. */
export const useSuggestions = (): readonly string[] =>
  useSyncExternalStore(subscribe, drawnOrOpening, opening);
