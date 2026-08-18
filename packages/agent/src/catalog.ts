/**
 * The chat's model choices, importable from the client: everything else in
 * this package sits behind the server-only guard with the gateway key and the
 * CLI-spawning connector. Ids are `vendor/model`, the form OpenAI-compatible
 * gateways route on.
 */
export interface ModelChoice {
  readonly id: string;
  readonly label: string;
}

export const DEFAULT_MODEL = "qwen/qwen-3.8";

/**
 * The models benchmarked against ledger work at openledger.sh, kept to the
 * ones that answered best per token spent. A model earns its row here by
 * benchmark, not by novelty.
 */
export const RECOMMENDED_MODELS: readonly ModelChoice[] = [
  { id: DEFAULT_MODEL, label: "Qwen 3.8" },
  { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
];
