import { ChatOpenAI } from "@langchain/openai";

import { DEFAULT_MODEL } from "./catalog";

export const isAiEnabled = (): boolean =>
  Boolean(
    process.env.OPENAI_COMPATIBLE_BASE_URL &&
      process.env.OPENAI_COMPATIBLE_API_KEY,
  );

/**
 * Any endpoint speaking the OpenAI wire protocol: the OpenAI chat model class
 * is the client, and the gateway is whatever `OPENAI_COMPATIBLE_BASE_URL`
 * names. Keyless local endpoints still want a non-empty
 * `OPENAI_COMPATIBLE_API_KEY`; any string satisfies them.
 */
export const model = (id?: string): ChatOpenAI => {
  const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL;
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY;
  if (!baseURL || !apiKey) {
    throw new Error(
      "OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_API_KEY are not set; gate calls with isAiEnabled()",
    );
  }

  return new ChatOpenAI({
    model: id ?? process.env.OPENAI_COMPATIBLE_MODEL ?? DEFAULT_MODEL,
    apiKey,
    // Figures are read from the ledger, never sampled.
    temperature: 0,
    configuration: { baseURL },
  });
};
