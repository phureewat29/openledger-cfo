import type { Metadata } from "next";

import { isAiEnabled } from "@openledger-cfo/agent";
import { fontClassNames } from "@openledger-cfo/ui/fonts";

import { ChatPane } from "~/components/chat/chat-pane";
import { ChatDock } from "~/components/chat/dock";
import { pickSuggestions } from "~/components/chat/suggestions";
import { CliLogProvider } from "~/components/cli-log-provider";
import { IngestRunProvider } from "~/components/ingest-run-provider";
import { Rail } from "~/components/rail";
import { StatusBar } from "~/components/status-bar";
import { loadChrome, loadRailBadges, NO_BADGES } from "~/server/chrome";
import { TRPCReactProvider } from "~/trpc/react";

import "~/app/styles.css";

export const metadata: Metadata = {
  title: "OpenLedger CFO",
  description: "A terminal for your money on the OpenLedger data plane",
};

// The chrome quotes the ledger, so it is read per request like everything else.
export const dynamic = "force-dynamic";

export default async function RootLayout(props: { children: React.ReactNode }) {
  const [chrome, badges] = await Promise.all([loadChrome(), loadRailBadges()]);
  const enabled = isAiEnabled();

  return (
    <html lang="en" className={fontClassNames}>
      <body className="bg-background text-foreground h-screen overflow-hidden font-sans antialiased">
        <TRPCReactProvider>
          <CliLogProvider>
            <IngestRunProvider>
              <ChatDock>
                <div className="grid h-full grid-rows-[minmax(0,1fr)_1.5rem]">
                  {/* The chat column is sized so the data column clears the wide
                  tier (896px) at a 1280 viewport: 26vw left it five pixels
                  short, which dropped a whole laptop width onto the stacked
                  layout. Below 1280 the clamp floor governs and nothing moves,
                  and the cap only binds past 1920, where the measure can take
                  the extra width without the data column noticing. */}
                  <div className="grid min-h-0 grid-cols-[3.5rem_minmax(0,1fr)] lg:grid-cols-[3.5rem_minmax(0,1fr)_clamp(320px,25vw,480px)]">
                    <Rail
                      badges={badges.ok ? badges.value : NO_BADGES}
                      ledgerBad={!chrome.ok || chrome.value.stale}
                    />
                    <main
                      id="main"
                      className="@container/main min-h-0 min-w-0 overflow-y-auto"
                    >
                      {props.children}
                    </main>
                    <ChatPane enabled={enabled} openers={pickSuggestions()} />
                  </div>
                  <StatusBar chrome={chrome} aiEnabled={enabled} />
                </div>
              </ChatDock>
            </IngestRunProvider>
          </CliLogProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
