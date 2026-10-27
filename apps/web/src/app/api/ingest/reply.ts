/** The failure body every ingest route answers with; the pane shows `error` as it stands. */
export const fail = (status: number, error: string): Response =>
  Response.json({ ok: false, error }, { status });
