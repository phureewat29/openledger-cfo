import { Fragment } from "react";
import Link from "next/link";

interface Crumb {
  readonly label: string;
  /** The last crumb is where the reader already is, so it carries no link. */
  readonly href?: string;
}

/**
 * Sticky against `main`, which is the only thing on these pages that scrolls,
 * so the trail stays readable on a window too short for the grid below it.
 */
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="label border-border bg-background sticky top-0 z-20 flex h-7 shrink-0 items-center gap-1.5 border-b px-3"
    >
      {crumbs.map((crumb, index) => (
        <Fragment key={crumb.href ?? `leaf:${crumb.label}`}>
          {index === 0 ? null : (
            <span aria-hidden className="text-muted-foreground/60">
              /
            </span>
          )}
          {crumb.href === undefined ? (
            <span aria-current="page" className="text-foreground truncate">
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="hover:text-foreground shrink-0 transition-colors"
            >
              {crumb.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
