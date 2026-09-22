// Minimal mock of the `vscode` module for unit tests. `vscode` isn't a real
// installed package — it's only ever provided at runtime by the VS Code
// Extension Host — so this is aliased in place of it (see vitest.config.ts).
// Extend this as tests need more of the API surface; keep it to what's used.
import { vi } from "vitest";

export class Uri {
  private constructor(public readonly fsPath: string) {}

  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  static joinPath(base: Uri, ...paths: string[]): Uri {
    return new Uri([base.fsPath, ...paths].join("/"));
  }
}

export const workspace = {
  workspaceFolders: undefined as { uri: Uri; name: string }[] | undefined,
  findFiles: vi.fn(),
  asRelativePath: vi.fn(),
  getWorkspaceFolder: vi.fn(),
  fs: {
    readFile: vi.fn(),
  },
};

export const window = {
  showWarningMessage: vi.fn(),
  showTextDocument: vi.fn(),
  createTerminal: vi.fn(),
};

export const commands = {
  executeCommand: vi.fn(),
};
