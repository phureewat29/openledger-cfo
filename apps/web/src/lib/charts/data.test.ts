import { describe, expect, it } from "vitest";

import { paddedDomain } from "./data";

describe("paddedDomain", () => {
  it("lends a flat series the minimum span, evenly at both ends", () => {
    expect(paddedDomain(5, 5)).toEqual({ low: 4.5, high: 5.5 });
  });

  it("lends a narrow series only its shortfall", () => {
    expect(paddedDomain(2, 2.5)).toEqual({ low: 1.75, high: 2.75 });
  });

  it("leaves a series wider than the minimum as drawn", () => {
    expect(paddedDomain(-3, 10)).toEqual({ low: -3, high: 10 });
  });
});
