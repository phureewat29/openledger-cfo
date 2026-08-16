import type { UIMessage } from "ai";
import { sampleSize } from "es-toolkit";

/**
 * The transcript's message shape. The stream appends the follow-up chips it
 * generated as a `data-suggestions` part, so they ride along with the answer
 * they belong to and survive a route change like any other part.
 */
export type CfoChatMessage = UIMessage<unknown, { suggestions: string[] }>;

const PICK_COUNT = 4;

/**
 * Openers for an empty pane. Every one asks about the household's own money —
 * what it did, where it went, what it means — against figures the briefing or a
 * tool can actually produce. Nothing administrative: tidying account names and
 * hunting duplicate rows are chores, not questions worth putting to a CFO, and
 * nothing about budgets or reminders, which live in the control plane and not
 * in its hands. Short enough to read whole at the pane's narrowest, and phrased
 * as an ask rather than a question so the strip stays quiet.
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
  "Where is my money sitting",
  "Which account is bleeding money",

  "Project this month's spending",
  "Compare this year to last year",
  "What is my spending trend",
  "How does this month compare",
  "Where am I heading this quarter",

  "Am I spending more than I earn",
  "What are my fixed monthly costs",
  "Which month cost me the most",
  "How much have I spent this year",
  "What is my largest monthly bill",

  "Can I afford a big trip",
  "Should I pay down debt first",
  "Can I afford to invest more",
  "What would cutting dining save",
  "Is now a good time to spend",
];

/**
 * Drawn on the server, once per request, and handed down as a prop. The layout
 * is already `force-dynamic`, so a fresh four cost nothing and arrive in the
 * first paint — drawing in the browser instead would rewrite all four lines a
 * beat after the reader's eyes had reached them.
 */
export const pickSuggestions = (): readonly string[] =>
  sampleSize(SUGGESTION_POOL, PICK_COUNT);
