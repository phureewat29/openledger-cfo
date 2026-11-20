import type { Metadata } from "next";

import { readGateway } from "@openledger-cfo/api";
import { fontClassNames } from "@openledger-cfo/ui/fonts";

import { ChatPane } from "~/chat/chat-pane";
import { ChatDock } from "~/chat/dock";
import { pickSuggestions } from "~/chat/suggestions";
import { ConfigDialogProvider } from "~/config/config-dialog-provider";
import { IngestRunProvider } from "~/ingest/run-provider";
import { CliLogProvider } from "~/shell/cli-log-provider";
import { loadChrome, loadRailBadges } from "~/shell/load";
import { Rail } from "~/shell/rail";
import { StatusBar } from "~/shell/status-bar";
import { TRPCReactProvider } from "~/trpc/react";

import "~/app/styles.css";

export const metadata: Metadata = {
  title: "OpenLedger CFO",
  description: "A terminal for your money on the OpenLedger data plane",
};

// The chrome quotes the ledger, so it is read per request like everything else.
export const dynamic = "force-dynamic";

export default async function RootLayout(props: { children: React.ReactNode }) {
  const [chrome, badges, gateway] = await Promise.all([
    loadChrome(),
    loadRailBadges(),
    readGateway(),
  ]);

  return (
    <html lang="en" className={fontClassNames}>
      <body className="bg-background text-foreground h-screen overflow-hidden font-sans antialiased">
        <TRPCReactProvider>
          <CliLogProvider>
            <IngestRunProvider>
              <ChatDock>
                <ConfigDialogProvider>
                  <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_1.5rem]">
                    {/* Sized so the data column clears the 896px wide tier at a
                    1280 viewport; 26vw left it five pixels short. */}
                    <div className="grid min-h-0 grid-cols-[3.5rem_minmax(0,1fr)] lg:grid-cols-[3.5rem_minmax(0,1fr)_clamp(320px,25vw,480px)]">
                      <Rail
                        badges={badges}
                        ledgerBad={!chrome.ok || chrome.value.stale}
                      />
                      <main
                        id="main"
                        // Focus target of last resort for the settings dialog.
                        tabIndex={-1}
                        className="@container/main min-h-0 min-w-0 overflow-y-auto"
                      >
                        {props.children}
                      </main>
                      <ChatPane
                        ledgerOk={chrome.ok}
                        ai={gateway && { model: gateway.model }}
                        openers={pickSuggestions()}
                      />
                    </div>
                    <StatusBar
                      chrome={chrome}
                      aiConfigured={gateway !== undefined}
                    />
                  </div>
                </ConfigDialogProvider>
              </ChatDock>
            </IngestRunProvider>
          </CliLogProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
