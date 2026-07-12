import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname
    }
  },
  oxc: false,
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react"
  }
});
