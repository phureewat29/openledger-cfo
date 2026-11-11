"use client";

import { Streamdown } from "streamdown";

/**
 * The renderer and everything it parses with is heavy, and nothing on any page
 * needs it until an answer starts arriving. Its own module is what lets it
 * arrive then.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    // Streamdown's overlays would render unstyled: Tailwind never scans its classes.
    <Streamdown
      linkSafety={{ enabled: false }}
      controls={{ table: { fullscreen: false } }}
    >
      {children}
    </Streamdown>
  );
}
