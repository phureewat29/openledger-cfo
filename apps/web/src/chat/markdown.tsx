"use client";

import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

const PLUGINS = { code };

// Its own module so the heaviest dependency loads only once an answer arrives.
export default function Markdown({ children }: { children: string }) {
  return (
    // Its link modal and fullscreen table use colours the theme lacks; the wrapper
    // clears the code block's action-bar border, which falls back to currentColor.
    <Streamdown
      plugins={PLUGINS}
      linkSafety={{ enabled: false }}
      controls={{ table: { fullscreen: false } }}
    >
      {children}
    </Streamdown>
  );
}
