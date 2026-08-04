import { ChatOpenAI } from "@langchain/openai";

const BASE_URL = "https://openrouter.ai/api/v1";

const DEFAULT_MODEL = "openai/gpt-5.6-luna";

export const isAiEnabled = (): boolean =>
  Boolean(process.env.OPENROUTER_API_KEY);

/**
 * OpenRouter speaks the OpenAI wire protocol, so the OpenAI chat model class is
 * the client; only the base URL and the `vendor/model` id differ.
 */
export const model = (): ChatOpenAI => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set; gate calls with isAiEnabled()",
    );
  }

  return new ChatOpenAI({
    model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
    apiKey,
    // Figures are read from the ledger, never sampled.
    temperature: 0,
    configuration: { baseURL: BASE_URL },
  });
};
