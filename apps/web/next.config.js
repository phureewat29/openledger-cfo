import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

// Import env files to validate at build time. Use jiti so we can load .ts files in here.
await jiti.import("./src/env");

/** @type {import("next").NextConfig} */
const config = {
  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    // Only the `/sanitize` subpath is client-reachable; the entry point is server-only.
    "@openledger-cfo/agent",
    "@openledger-cfo/api",
    "@openledger-cfo/db",
    "@openledger-cfo/ui",
  ],

  /** Memoises components and hooks so hand-written memo hygiene is not the plan */
  reactCompiler: true,

  /** We already do linting and typechecking as separate tasks in CI */
  typescript: { ignoreBuildErrors: true },
};

export default config;
