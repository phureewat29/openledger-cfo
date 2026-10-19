import { attempt, isString } from "es-toolkit";

/**
 * Any object reads as a record, class instances included: LangChain hands its
 * messages over as instances in-process, which `isPlainObject` would turn away.
 */
export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export const asString = (value: unknown): string =>
  isString(value) ? value : "";

/** Valid JSON never parses to `undefined`, so it doubles as the failure signal. */
export const parseJson = (text: string): unknown => {
  const [error, value] = attempt<unknown, unknown>(() => JSON.parse(text));
  return error === null ? value : undefined;
};

/** Pulls plain text out of string content or a content-block array. */
export const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(asRecord)
    .filter((part) => part.type === "text")
    .map((part) => asString(part.text))
    .join("");
};
