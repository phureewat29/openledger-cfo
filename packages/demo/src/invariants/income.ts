import { sumBy } from "es-toolkit";

import type { Life } from "../dataset";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { formatMoney, fromUnits, toUnits } from "../money";
import { legsOf } from "../types";
import { check, linkedGroupsCrediting } from "./shared";

const PAYSLIP_MIN_RATE = 0.22;
const PAYSLIP_MAX_RATE = 0.26;

/**
 * A payslip's legs are the whole of gross pay: what the employee sees, what the
 * revenue department takes, what social security takes and what the provident
 * fund keeps. If they do not add back to gross, money was invented.
 */
export const payslipCheck = (life: Life, rows: SeedRow[]): Check => {
  const source = life.meta.products.incomeSources.find(
    (entry) => entry.key === "employment",
  );
  if (!source)
    return check("employment payslips reconcile", false, "no source");

  const groups = linkedGroupsCrediting(rows, source.account);
  const faults: string[] = [];

  for (const group of groups) {
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

    if (legs.length !== 4)
      faults.push(`${group.date} has ${String(legs.length)} legs`);
    if (netUnits <= 0) faults.push(`${group.date} pays nothing to the bank`);
    const rate = grossUnits === 0 ? 0 : taxUnits / grossUnits;
    if (rate < PAYSLIP_MIN_RATE || rate > PAYSLIP_MAX_RATE) {
      faults.push(`${group.date} withholds ${(rate * 100).toFixed(1)}%`);
    }
  }

  return check(
    "employment payslips reconcile",
    groups.length > 0 && faults.length === 0,
    faults.slice(0, 3).join(" · "),
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
  const faults: string[] = [];

  for (const group of groups) {
    const legs = legsOf(group).filter(
      (entry) => entry.credit_account === source.account,
    );
    const grossUnits = sumBy(legs, (entry) => toUnits(entry.amount));
    const whtUnits = sumBy(
      legs.filter((entry) => entry.debit_account === source.taxAccount),
      (entry) => toUnits(entry.amount),
    );
    if (legs.length !== 2)
      faults.push(`${group.date} has ${String(legs.length)} legs`);
    if (whtUnits !== Math.round(grossUnits * CONSULTING_RATE)) {
      faults.push(
        `${group.date} withholds ${formatMoney(fromUnits(whtUnits))}`,
      );
    }
  }

  return check(
    "consulting invoices reconcile",
    groups.length > 0 && faults.length === 0,
    faults.slice(0, 3).join(" · "),
  );
};
