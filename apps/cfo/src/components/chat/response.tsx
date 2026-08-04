"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";

import { cn } from "@openledger-fleet/ui";

/** Markdown from the model is styled here rather than via a typography plugin. */
const MARKDOWN = [
  "min-w-0 text-sm leading-relaxed",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_p]:my-3",
  "[&_strong]:font-medium [&_strong]:text-foreground",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1",
  // One step per level, ending on the body size: a heading that matched the one
  // above it stopped saying which level it was.
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-medium",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[15px] [&_h2]:font-medium",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-medium",
  "[&_code]:rounded [&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_a]:underline [&_a]:underline-offset-2",
  // The column is a few hundred pixels at most, so anything unwrappable
  // scrolls inside itself.
  "[&_pre]:overflow-x-auto [&_pre]:rounded-lg",
  "[&_table]:my-3 [&_table]:w-full [&_table]:text-xs [&_td]:border-t [&_td]:border-border [&_td]:py-1.5 [&_th]:py-1.5 [&_th]:text-left",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
].join(" ");

// No `loading`, so the boundary below is the one that catches it and the
// answer's own text can stand in for it.
const Markdown = dynamic(() => import("./markdown"));

/**
 * The first tokens are what fetch the renderer, and they read perfectly well
 * as plain text in the meantime: the same box, the same measure, only the
 * asterisks still showing.
 */
export function Response({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn(MARKDOWN, className)}>
      <Suspense fallback={<p className="whitespace-pre-wrap">{children}</p>}>
        <Markdown>{children}</Markdown>
      </Suspense>
    </div>
  );
}
