import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // `vscode` only exists at runtime inside the VS Code Extension Host —
      // point it at a mock so host-side modules can be imported under Node.
      vscode: path.resolve(import.meta.dirname, "test/mocks/vscode.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "webview/src/**/*.test.ts", "shared/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
  },
});
