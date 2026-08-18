import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center p-3">
      <section className="border-border bg-card flex w-full max-w-md flex-col gap-3 rounded-lg border p-4">
        <span className="label">Not found</span>
        <p className="text-muted-foreground text-xs">
          This page does not exist.
        </p>
        <Link href="/" className="text-accent text-xs">
          Back to Everything
        </Link>
      </section>
    </div>
  );
}
