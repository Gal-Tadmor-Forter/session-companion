import { beforeEach, describe, expect, it, vi } from "vitest";
// Imported by relative path (not the bare "vscode" specifier) so this file type-checks
// against our own mock's shape — the real @types/vscode declares `workspaceFolders` as
// read-only. Vitest's alias (vitest.config.ts) resolves both to the same module instance
// at runtime, so this is still exactly what `fileMentions.ts`'s `import ... from "vscode"`
// gets redirected to during tests.
import { Uri, workspace } from "../../../test/mocks/vscode";
import { searchWorkspaceFiles } from "../fileMentions";

beforeEach(() => {
  vi.mocked(workspace.findFiles).mockReset();
  vi.mocked(workspace.getWorkspaceFolder).mockReset();
  vi.mocked(workspace.fs.readFile).mockReset();
  vi.mocked(workspace.fs.readFile).mockRejectedValue(new Error("ENOENT"));
  workspace.workspaceFolders = undefined;
});

describe("searchWorkspaceFiles", () => {
  it("returns no results when there is no open workspace", async () => {
    const results = await searchWorkspaceFiles("foo", "/repo");
    expect(results).toEqual([]);
    expect(workspace.findFiles).not.toHaveBeenCalled();
  });

  it("searches with a wildcard pattern built from the query, always excluding .git/node_modules/dist", async () => {
    workspace.workspaceFolders = [{ uri: Uri.file("/repo"), name: "repo" }];
    vi.mocked(workspace.findFiles).mockResolvedValue([]);

    await searchWorkspaceFiles("agent", "/repo");

    expect(workspace.findFiles).toHaveBeenCalledWith(
      "**/*agent*",
      "{**/.git/**,**/node_modules/**,**/dist/**}",
      500
    );
  });

  it("falls back to matching everything when the query is blank", async () => {
    workspace.workspaceFolders = [{ uri: Uri.file("/repo"), name: "repo" }];
    vi.mocked(workspace.findFiles).mockResolvedValue([]);

    await searchWorkspaceFiles("   ", "/repo");

    expect(workspace.findFiles).toHaveBeenCalledWith(
      "**/*",
      "{**/.git/**,**/node_modules/**,**/dist/**}",
      500
    );
  });

  it("computes relativePath against cwd (not the file's own folder), with no repoName for a single-root workspace", async () => {
    workspace.workspaceFolders = [{ uri: Uri.file("/repo"), name: "repo" }];
    const found = Uri.file("/repo/src/agentSession.ts");
    vi.mocked(workspace.findFiles).mockResolvedValue([found]);
    vi.mocked(workspace.getWorkspaceFolder).mockReturnValue(workspace.workspaceFolders[0]);

    const results = await searchWorkspaceFiles("agent", "/repo");

    expect(results).toEqual([
      { relativePath: "src/agentSession.ts", absolutePath: "/repo/src/agentSession.ts", repoName: undefined },
    ]);
  });

  it("computes a cwd-relative path across workspace folders and sets repoName, in a multi-root workspace", async () => {
    const platformHub = { uri: Uri.file("/dev/platform-hub"), name: "platform-hub" };
    const portal = { uri: Uri.file("/dev/portal"), name: "portal" };
    workspace.workspaceFolders = [platformHub, portal];
    const found = Uri.file("/dev/portal/src/index.ts");
    vi.mocked(workspace.findFiles).mockResolvedValue([found]);
    vi.mocked(workspace.getWorkspaceFolder).mockReturnValue(portal);

    // The chat's own cwd is platform-hub, but the match lives in the sibling "portal"
    // folder — the inserted "@path" must still resolve correctly from platform-hub.
    const results = await searchWorkspaceFiles("index", "/dev/platform-hub");

    expect(results).toEqual([
      {
        relativePath: "../portal/src/index.ts",
        absolutePath: "/dev/portal/src/index.ts",
        repoName: "portal",
      },
    ]);
  });

  it("skips a URI outside every open workspace folder", async () => {
    workspace.workspaceFolders = [{ uri: Uri.file("/repo"), name: "repo" }];
    vi.mocked(workspace.findFiles).mockResolvedValue([Uri.file("/elsewhere/file.ts")]);
    vi.mocked(workspace.getWorkspaceFolder).mockReturnValue(undefined);

    const results = await searchWorkspaceFiles("file", "/repo");

    expect(results).toEqual([]);
  });

  it("filters out a file matched by the owning folder's root .gitignore", async () => {
    workspace.workspaceFolders = [{ uri: Uri.file("/repo"), name: "repo" }];
    vi.mocked(workspace.getWorkspaceFolder).mockReturnValue(workspace.workspaceFolders[0]);
    vi.mocked(workspace.fs.readFile).mockResolvedValue(Buffer.from("coverage/\n"));
    vi.mocked(workspace.findFiles).mockResolvedValue([
      Uri.file("/repo/coverage/src/index.ts.html"),
      Uri.file("/repo/src/index.ts"),
    ]);

    const results = await searchWorkspaceFiles("index", "/repo");

    expect(results).toEqual([
      { relativePath: "src/index.ts", absolutePath: "/repo/src/index.ts", repoName: undefined },
    ]);
  });

  it("doesn't filter anything extra when the folder has no readable .gitignore", async () => {
    workspace.workspaceFolders = [{ uri: Uri.file("/repo"), name: "repo" }];
    vi.mocked(workspace.getWorkspaceFolder).mockReturnValue(workspace.workspaceFolders[0]);
    vi.mocked(workspace.findFiles).mockResolvedValue([Uri.file("/repo/src/index.ts")]);

    const results = await searchWorkspaceFiles("index", "/repo");

    expect(results).toEqual([
      { relativePath: "src/index.ts", absolutePath: "/repo/src/index.ts", repoName: undefined },
    ]);
  });

  it("caps results at 20 even when more candidates survive filtering", async () => {
    workspace.workspaceFolders = [{ uri: Uri.file("/repo"), name: "repo" }];
    vi.mocked(workspace.getWorkspaceFolder).mockReturnValue(workspace.workspaceFolders[0]);
    const candidates = Array.from({ length: 25 }, (_, i) => Uri.file(`/repo/src/file${i}.ts`));
    vi.mocked(workspace.findFiles).mockResolvedValue(candidates);

    const results = await searchWorkspaceFiles("file", "/repo");

    expect(results).toHaveLength(20);
  });
});
