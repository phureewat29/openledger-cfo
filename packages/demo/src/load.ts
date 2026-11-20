import type { OledError, OpenLedger, Result } from "@openledger-cfo/openledger";
import { ok } from "@openledger-cfo/openledger";

import type { Life } from "./dataset";
import type { Check } from "./invariants";
import { checkInvariants } from "./invariants";
import { bootstrapLedger, openDemoLedger } from "./ledger";
import { log } from "./report";
import { verifyLedger } from "./verify";

/** One batch per month in file order: no random draw and no clock, so two loads of one file write the same ledger. */
const loadLife = async (
  oled: OpenLedger,
  life: Life,
  keep: boolean,
): Promise<Result<true, OledError>> => {
  const bootstrapped = await bootstrapLedger(oled, {
    config: life.meta.config,
    accounts: life.accounts,
    merchants: life.merchants,
    keep,
  });
  if (!bootstrapped.ok) return bootstrapped;

  let running = 0;
  for (const chunk of life.months) {
    const posted = await oled.bootstrap.ingestCommitBatch(chunk.rows);
    if (!posted.ok) return posted;
    running += posted.value.summary.posted;
    log(
      `post ${chunk.month}  ${String(chunk.rows.length).padStart(4)} rows  running ${String(running).padStart(5)}`,
    );
  }

  return ok(true);
};

interface Proof {
  checks: Check[];
  facts: string[];
}

/** The pure invariants, then a real load, then a read-back of that same ledger. */
export const proveLife = async (
  life: Life,
  keep: boolean,
): Promise<Result<Proof, OledError>> => {
  const invariants = checkInvariants(life);
  const oled = openDemoLedger();
  const loaded = await loadLife(oled, life, keep);
  if (!loaded.ok) return loaded;
  const verified = await verifyLedger(oled, life);
  if (!verified.ok) return verified;
  return ok({
    checks: [...invariants, ...verified.value.checks],
    facts: verified.value.facts,
  });
};
