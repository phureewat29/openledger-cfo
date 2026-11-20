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
    /**
     * Its link modal and fullscreen table paint with bg-primary, bg-muted and
     * bg-sidebar, which emit nothing: the theme defines none of those colours.
     * The code block's action bar borders in sidebar too, and a border with no
     * colour falls back to currentColor, so Response's wrapper clears it.
     */
    <Streamdown
      plugins={PLUGINS}
      linkSafety={{ enabled: false }}
      controls={{ table: { fullscreen: false } }}
    >
      {children}
    </Streamdown>
  );
}
