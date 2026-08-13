import type { RouterOutputs } from "@openledger-fleet/api";

type IngestFiles = RouterOutputs["ledger"]["ingest"]["list"];
type IngestQuestions = RouterOutputs["ledger"]["questions"]["list"];
export type IngestFile = IngestFiles["rows"][number];
export type IngestCounts = NonNullable<IngestFiles["summary"]>;
export type IngestQuestion = IngestQuestions["rows"][number];
export type IngestFileTransaction =
  RouterOutputs["ledger"]["transactions"]["listByFile"][number];
