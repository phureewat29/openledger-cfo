/** The teaser card for a section that exists on the rail before it exists. */
export function ComingSoon({ hook, body }: { hook: string; body: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-3">
      <section className="border-border bg-card flex w-full max-w-2xl flex-col gap-3 rounded-lg border p-4">
        <span className="label">Coming soon</span>
        <p className="text-base leading-tight font-medium">{hook}</p>
        <p className="text-muted-foreground text-xs">{body}</p>
      </section>
    </div>
  );
}
