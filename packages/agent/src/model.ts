import { ChatOpenAI } from "@langchain/openai";

/**
 * What this runtime needs to speak; the caller resolves and injects it. The
 * api's config store declares the same shape — structural on purpose, since
 * importing it here would invert the dependency direction.
 */
export interface GatewayConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/**
 * Any endpoint speaking the OpenAI wire protocol: the OpenAI chat model class
 * is the client, and the gateway is whatever the saved configuration names.
 * The caller resolves and injects it — this package holds no credentials.
 */
export const chatModel = (gateway: GatewayConfig): ChatOpenAI =>
  new ChatOpenAI({
    model: gateway.model,
    // The client refuses to construct without one; keyless endpoints ignore it.
    apiKey: gateway.apiKey === "" ? "none" : gateway.apiKey,
    // Figures are read from the ledger, never sampled.
    temperature: 0,
    configuration: { baseURL: gateway.baseUrl },
  });
