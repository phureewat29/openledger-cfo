import { describe, expect, it } from "vitest";

import { asOfFor, isStale, latestOf } from "./period";

describe("asOfFor", () => {
  it("ends at the ledger's newest activity when that is in the past", () => {
    expect(asOfFor("2026-08-10", "2026-11-12")).toBe("2026-08-10");
  });

  it("ends today for a ledger with no rows", () => {
    expect(asOfFor(undefined, "2026-11-12")).toBe("2026-11-12");
  });

  it("never lets a post-dated row carry it past today", () => {
    expect(asOfFor("2026-12-01", "2026-11-12")).toBe("2026-11-12");
    expect(asOfFor("2026-11-12", "2026-11-12")).toBe("2026-11-12");
  });
});

describe("isStale", () => {
  it("is false while the story ends inside the current month", () => {
    expect(isStale("2026-11-01", "2026-11-30")).toBe(false);
  });

  it("is true once the story ends before the current month began", () => {
    expect(isStale("2026-10-31", "2026-11-01")).toBe(true);
    expect(isStale("2025-11-12", "2026-11-12")).toBe(true);
  });
});

describe("latestOf", () => {
  it("is undefined for no dates", () => {
    expect(latestOf([])).toBeUndefined();
  });

  it("picks the newest date wherever it sits", () => {
    expect(latestOf(["2026-01-02", "2026-03-01", "2025-12-31"])).toBe(
      "2026-03-01",
    );
  });
});
