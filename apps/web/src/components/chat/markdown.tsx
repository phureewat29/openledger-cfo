"use client";

import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

const PLUGINS = { code };

/**
 * The renderer and everything it parses with — highlighting most of all — is
 * the heaviest thing this app can load, and nothing on any page needs it until
 * an answer starts arriving. Its own module is what lets it arrive then.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    // Streamdown's overlays would render unstyled: Tailwind never scans its classes.
    <Streamdown
      plugins={PLUGINS}
      linkSafety={{ enabled: false }}
      controls={{ table: { fullscreen: false } }}
    >
      {children}
    </Streamdown>
  );
}
