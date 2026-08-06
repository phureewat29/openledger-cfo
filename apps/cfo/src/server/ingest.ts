import type { RouterOutputs } from "@openledger-fleet/api";

export type IngestFiles = RouterOutputs["ledger"]["ingest"]["list"];
export type IngestQuestions = RouterOutputs["ledger"]["questions"]["list"];
export type IngestFile = IngestFiles["rows"][number];
export type IngestCounts = NonNullable<IngestFiles["summary"]>;
export type IngestQuestion = IngestQuestions["rows"][number];
export type IngestFileTransaction =
  RouterOutputs["ledger"]["transactions"]["listByFile"][number];
