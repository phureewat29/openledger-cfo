import { sumBy } from "es-toolkit";

import type { Life } from "../dataset";
import type { SeedRow } from "../rows";
import type { Check } from "./shared";
import { formatMoney, fromUnits, toUnits } from "../money";
import { legsOf } from "../rows";
import { check, detail } from "./shared";

const linkedGroupsCrediting = (rows: SeedRow[], account: string): SeedRow[] =>
  rows.filter(
    (seedRow) =>
      "linked" in seedRow &&
      seedRow.linked.some((entry) => entry.credit_account === account),
  );

const PAYSLIP_MIN_RATE = 0.22;
const PAYSLIP_MAX_RATE = 0.26;

/** A payslip's legs are the whole of gross pay; if they do not add back, money was invented. */
export const payslipCheck = (life: Life, rows: SeedRow[]): Check => {
  const source = life.meta.products.incomeSources.find(
    (entry) => entry.key === "employment",
  );
  if (!source)
    return check("employment payslips reconcile", false, "no source");

  const groups = linkedGroupsCrediting(rows, source.account);
  const faults = groups.flatMap((group) => {
    const legs = legsOf(group).filter(
      (entry) => entry.credit_account === source.account,
    );
    const grossUnits = sumBy(legs, (entry) => toUnits(entry.amount));
    const netUnits = sumBy(
      legs.filter((entry) => entry.debit_account === source.settlesTo),
      (entry) => toUnits(entry.amount),
    );
    const taxUnits = sumBy(
      legs.filter((entry) => entry.debit_account === source.taxAccount),
      (entry) => toUnits(entry.amount),
    );

    const rate = grossUnits === 0 ? 0 : taxUnits / grossUnits;
    return [
      ...(legs.length === 4
        ? []
        : [`${group.date} has ${String(legs.length)} legs`]),
      ...(netUnits > 0 ? [] : [`${group.date} pays nothing to the bank`]),
      ...(rate >= PAYSLIP_MIN_RATE && rate <= PAYSLIP_MAX_RATE
        ? []
        : [`${group.date} withholds ${(rate * 100).toFixed(1)}%`]),
    ];
  });

  return check(
    "employment payslips reconcile",
    groups.length > 0 && faults.length === 0,
    detail(faults),
  );
};

const CONSULTING_RATE = 0.03;

export const retainerCheck = (life: Life, rows: SeedRow[]): Check => {
  const source = life.meta.products.incomeSources.find(
    (entry) => entry.key === "consulting",
  );
  if (!source)
    return check("consulting invoices reconcile", false, "no source");

  const groups = linkedGroupsCrediting(rows, source.account);
  const faults = groups.flatMap((group) => {
    const legs = legsOf(group).filter(
      (entry) => entry.credit_account === source.account,
    );
    const grossUnits = sumBy(legs, (entry) => toUnits(entry.amount));
    const whtUnits = sumBy(
      legs.filter((entry) => entry.debit_account === source.taxAccount),
      (entry) => toUnits(entry.amount),
    );
    return [
      ...(legs.length === 2
        ? []
        : [`${group.date} has ${String(legs.length)} legs`]),
      ...(whtUnits === Math.round(grossUnits * CONSULTING_RATE)
        ? []
        : [`${group.date} withholds ${formatMoney(fromUnits(whtUnits))}`]),
    ];
  });

  return check(
    "consulting invoices reconcile",
    groups.length > 0 && faults.length === 0,
    detail(faults),
  );
};
