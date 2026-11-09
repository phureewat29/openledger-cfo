import { isString } from "es-toolkit";

export { parseJson } from "@openledger-cfo/openledger/result";

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
