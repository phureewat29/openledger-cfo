export type NodeKind = "income" | "hub" | "category" | "outcome";

export interface FlowNode {
  readonly id: string;
  readonly label: string;
  readonly kind: NodeKind;
  /** Monthly average in THB — the same unit every link carries. */
  readonly total: number;
}

export interface FlowLink {
  readonly source: string;
  readonly target: string;
  readonly value: number;
}

export interface FlowGraph {
  readonly nodes: readonly FlowNode[];
  readonly links: readonly FlowLink[];
}

/** One income account, averaged over the window. */
export interface IncomeLine {
  readonly id: string;
  readonly label: string;
  readonly monthly: number;
}

/** One top-level expense group, averaged over the window. */
export interface CategoryLine {
  /** Third account segment (`food`, `transport`) — the slider's key. */
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly monthly: number;
  /** Nobody decides their way out of tax or loan interest in a month. */
  readonly committed: boolean;
}

/**
 * Everything the sliders bend, already reduced to per-month figures so the
 * what-if math never has to divide again.
 */
export interface Baseline {
  /** Newest date the ledger has activity for. */
  readonly asOf: string;
  readonly from: string;
  readonly to: string;
  /** Months inside the window the ledger actually covered — the divisor. */
  readonly months: number;
  readonly income: readonly IncomeLine[];
  readonly categories: readonly CategoryLine[];
  readonly monthlyIncome: number;
  readonly monthlySpend: number;
  readonly monthlySaved: number;
  readonly savingsRate: number;
  readonly graph: FlowGraph;
}
