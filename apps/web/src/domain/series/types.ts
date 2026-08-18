/** One sample of a series. `x` is already the label its axis prints. */
export interface Point {
  readonly x: string;
  readonly y: number;
}

/** One band of a stacked column, aligned to the chart's month labels. */
export interface BarSeries {
  readonly key: string;
  readonly label: string;
  readonly values: readonly number[];
}

export interface CategoryTotal {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/**
 * What kind of story an account has to tell. One declaration, so the header
 * cells and the charts can never drift into disagreeing about the taxonomy.
 */
export type AccountKind = "card" | "loan" | "cash" | "position" | "basic";

/** What each kind of account is worth plotting. */
export type AccountSeries =
  | {
      readonly kind: "card";
      readonly months: readonly string[];
      readonly categories: readonly BarSeries[];
      readonly cycle: readonly CategoryTotal[];
    }
  | {
      readonly kind: "loan";
      readonly months: readonly string[];
      readonly principal: readonly number[];
      readonly interest: readonly number[];
      readonly balance: readonly Point[];
    }
  | { readonly kind: "cash"; readonly balance: readonly Point[] }
  | {
      readonly kind: "position";
      readonly basis: readonly Point[];
      /** Indices into `basis` whose month the position was bought in. */
      readonly buyPoints: readonly number[];
    }
  | { readonly kind: "basic" };
