import { ChatOpenAI } from "@langchain/openai";

/**
 * The runtime's own port; the caller injects it. The api store declares the
 * same shape structurally — core stays out of the persistence context, which
 * only the `tools/caller` adapter reaches.
 */
export interface GatewayConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/** Any OpenAI-wire endpoint; the config is injected — this package holds no credentials. */
export const chatModel = (gateway: GatewayConfig): ChatOpenAI =>
  new ChatOpenAI({
    model: gateway.model,
    // The client refuses to construct without one; keyless endpoints ignore it.
    apiKey: gateway.apiKey === "" ? "none" : gateway.apiKey,
    // Figures are read from the ledger, never sampled.
    temperature: 0,
    configuration: { baseURL: gateway.baseUrl },
  });
