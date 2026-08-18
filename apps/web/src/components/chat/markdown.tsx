"use client";

import { Streamdown } from "streamdown";

/**
 * The renderer and everything it parses with — highlighting, maths — is the
 * heaviest thing this app can load, and nothing on any page needs it until an
 * answer starts arriving. Its own module is what lets it arrive then.
 */
export default function Markdown({ children }: { children: string }) {
  return <Streamdown>{children}</Streamdown>;
}
