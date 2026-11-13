import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // tsconfig keeps Next's `jsx: preserve`; a test that imports a component
  // needs its JSX compiled.
  oxc: { jsx: { runtime: "automatic" } },
});
