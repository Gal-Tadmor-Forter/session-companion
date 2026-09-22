// `acquireVsCodeApi()` only exists inside an actual VS Code webview at runtime.
// Modules like App.tsx call it at import time (webview/src/lib/vscodeApi.ts),
// so it needs to exist before any such module is imported under test.
(globalThis as { acquireVsCodeApi?: () => { postMessage: (message: unknown) => void } }).acquireVsCodeApi =
  () => ({ postMessage: () => undefined });
