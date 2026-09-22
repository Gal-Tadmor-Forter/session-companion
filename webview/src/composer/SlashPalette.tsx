import { Fragment, useEffect, useState } from "react";
import { Paperclip, AtSign, X, Undo2, GitFork, FolderPlus, ChevronLeft, Plus, RefreshCw } from "lucide-react";
import type {
  AccountInfoResult,
  AgentInfoEntry,
  EffortLevelId,
  McpServerStatusEntry,
  ModelOption,
  NewMcpServerConfig,
  SlashCommandEntry,
} from "../../../shared/protocol";
import { MenuItem, MenuSectionLabel, MenuDivider } from "../components/MenuItem";
import { EffortSlider } from "../components/EffortSlider";
import { Button } from "../components/Button";
import { Tooltip } from "../components/Tooltip";
import { matchesName, matchesNameOrDescription } from "../utils/paletteSearch";

type View = "root" | "model" | "outputStyles" | "agents" | "mcp" | "commands" | "skills" | "account";

interface SlashPaletteProps {
  onClose: () => void;
  models: ModelOption[];
  selectedModel: string;
  effort: EffortLevelId;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: EffortLevelId) => void;
  thinkingEnabled: boolean;
  onToggleThinking: () => void;
  outputStyles: string[];
  onRequestOutputStyles: () => void;
  onSetOutputStyle: (style: string) => void;
  agents: AgentInfoEntry[];
  onRequestAgents: () => void;
  mcpServers: McpServerStatusEntry[];
  onRequestMcpServers: () => void;
  onToggleMcpServer: (name: string, enabled: boolean) => void;
  onReconnectMcpServer: (name: string) => void;
  onSetMcpPermissionModeOverride: (name: string, mode: "default" | "auto" | null) => void;
  onAddMcpServer: (name: string, config: NewMcpServerConfig) => void;
  slashCommands: SlashCommandEntry[];
  onRequestSlashCommands: () => void;
  onInsertCommand: (name: string) => void;
  skills: SlashCommandEntry[];
  onRequestSkills: () => void;
  account: AccountInfoResult | undefined;
  onRequestAccountInfo: () => void;
  focusView: boolean;
  onToggleFocusView: () => void;
  onAttachFile: () => void;
  onMentionFile: () => void;
  onClearConversation: () => void;
  onRewind: () => void;
  onAddDirectory: () => void;
  canFork: boolean;
  onForkSession: () => void;
  onOpenClaudeMd: () => void;
  onOpenSettingsJson: () => void;
  onReloadPlugins: () => void;
  onOpenClaudeInTerminal: () => void;
  onOpenExternalUrl: (url: string) => void;
}

export function SlashPalette(props: SlashPaletteProps) {
  const [view, setView] = useState<View>("root");
  const [filter, setFilter] = useState("");
  // The SDK's setMcpPermissionModeOverride is set-only — there's no way to read back
  // what's currently pinned for a server, so this is a local, optimistic-only record
  // (resets whenever the palette remounts). Cycles null -> 'default' -> 'auto' -> null.
  const [mcpOverrides, setMcpOverrides] = useState<Record<string, "default" | "auto" | null>>({});
  const cycleMcpOverride = (name: string) => {
    const current = mcpOverrides[name] ?? null;
    const next = current === null ? "default" : current === "default" ? "auto" : null;
    setMcpOverrides((o) => ({ ...o, [name]: next }));
    props.onSetMcpPermissionModeOverride(name, next);
  };
  const [addingServer, setAddingServer] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [newServerCommand, setNewServerCommand] = useState("");
  const [newServerArgs, setNewServerArgs] = useState("");
  const submitNewServer = () => {
    const name = newServerName.trim();
    const command = newServerCommand.trim();
    if (!name || !command) return;
    props.onAddMcpServer(name, { type: "stdio", command, args: newServerArgs.trim().split(/\s+/).filter(Boolean) });
    setNewServerName("");
    setNewServerCommand("");
    setNewServerArgs("");
    setAddingServer(false);
  };

  // Slash commands are already fetched app-wide at mount (so inline "/" autocomplete has
  // something to filter against immediately) — but MCP servers/agents/skills are normally
  // only fetched lazily when the user drills into that specific subview. Searching from the
  // root view needs all of them up front, or a search for e.g. an MCP server's name would
  // come up empty just because that subview was never opened this session.
  useEffect(() => {
    props.onRequestMcpServers();
    props.onRequestAgents();
    props.onRequestSkills();
  }, []);

  const goTo = (next: View) => {
    setView(next);
    if (next === "outputStyles") props.onRequestOutputStyles();
    if (next === "agents") props.onRequestAgents();
    if (next === "mcp") props.onRequestMcpServers();
    if (next === "commands") props.onRequestSlashCommands();
    if (next === "skills") props.onRequestSkills();
    if (next === "account") props.onRequestAccountInfo();
  };

  const q = filter.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);

  // Only searched (not browsed) from the root view — dumping all ~100 slash commands
  // into the default menu would bury everything else. Populated as soon as the palette
  // opens (see the mount effect above), not just once its own subview has been visited,
  // so a search finds them even if the user never drilled into "MCP servers" etc. first.
  const matchingCommands = props.slashCommands.filter((c) => matchesNameOrDescription(c, filter));
  const matchingMcpServers = props.mcpServers.filter((s) => matchesName(s, filter));
  const matchingAgents = props.agents.filter((a) => matchesNameOrDescription(a, filter));
  const matchingSkills = props.skills.filter((s) => matchesNameOrDescription(s, filter));

  const contextVisible =
    matches("Attach file") ||
    matches("Mention file from this project") ||
    matches("Clear conversation") ||
    matches("Rewind") ||
    matches("Add folder to this chat") ||
    (matches("Fork conversation") && props.canFork);
  const modelVisible = matches("Switch model") || matches("Effort") || matches("Thinking") || matches("Account");
  const customizeVisible =
    matches("Output styles") ||
    matches("Agents") ||
    matches("MCP servers") ||
    matches("Slash commands") ||
    matches("Skills") ||
    matches("Hooks") ||
    matches("Permissions") ||
    matches("Memory") ||
    matches("Manage plugins") ||
    matches("Open Claude in Terminal");
  const settingsVisible = matches("General config") || matches("Focus view");
  const supportVisible = matches("View help docs") || matches("Report a problem");

  const rootSections = [
    {
      key: "context",
      visible: contextVisible,
      render: () => (
        <>
          <MenuSectionLabel>Context</MenuSectionLabel>
          {matches("Attach file") && (
            <MenuItem icon={<Paperclip size={14} />} label="Attach file..." onClick={() => act(props.onAttachFile, props.onClose)} />
          )}
          {matches("Mention file from this project") && (
            <MenuItem
              icon={<AtSign size={14} />}
              label="Mention file from this project..."
              onClick={() => act(props.onMentionFile, props.onClose)}
            />
          )}
          {matches("Clear conversation") && (
            <MenuItem icon={<X size={14} />} label="Clear conversation" onClick={() => act(props.onClearConversation, props.onClose)} />
          )}
          {matches("Rewind") && (
            <MenuItem icon={<Undo2 size={14} />} label="Rewind" onClick={() => act(props.onRewind, props.onClose)} />
          )}
          {matches("Add folder to this chat") && (
            <MenuItem
              icon={<FolderPlus size={14} />}
              label="Add folder to this chat..."
              description="Grants access beyond this chat's own folder — applies now, or on your next new chat if this one's already running"
              onClick={() => act(props.onAddDirectory, props.onClose)}
            />
          )}
          {matches("Fork conversation") && props.canFork && (
            <MenuItem
              icon={<GitFork size={14} />}
              label="Fork conversation"
              description="Continue from here under a new session, leaving this one untouched"
              onClick={() => act(props.onForkSession, props.onClose)}
            />
          )}
        </>
      ),
    },
    {
      key: "model",
      visible: modelVisible,
      render: () => (
        <>
          <MenuSectionLabel>Model</MenuSectionLabel>
          {matches("Switch model") && (
            <MenuItem
              label="Switch model..."
              trailing={<span className="text-xs text-muted">{currentModelLabel(props)}</span>}
              onClick={() => goTo("model")}
            />
          )}
          {matches("Effort") && <EffortSlider value={props.effort} onChange={props.onEffortChange} />}
          {matches("Thinking") && (
            <ToggleRow label="Thinking" checked={props.thinkingEnabled} onToggle={props.onToggleThinking} />
          )}
          {matches("Account") && <MenuItem label="Account & usage..." onClick={() => goTo("account")} />}
        </>
      ),
    },
    {
      key: "customize",
      visible: customizeVisible,
      render: () => (
        <>
          <MenuSectionLabel>Customize</MenuSectionLabel>
          {matches("Output styles") && <MenuItem label="Output styles" onClick={() => goTo("outputStyles")} />}
          {matches("Agents") && <MenuItem label="Agents" onClick={() => goTo("agents")} />}
          {matches("MCP servers") && <MenuItem label="MCP servers" onClick={() => goTo("mcp")} />}
          {matches("Slash commands") && <MenuItem label="Slash commands" onClick={() => goTo("commands")} />}
          {matches("Skills") && <MenuItem label="Skills" onClick={() => goTo("skills")} />}
          {matches("Hooks") && (
            <MenuItem label="Hooks" description="Opens settings.json" onClick={() => act(props.onOpenSettingsJson, props.onClose)} />
          )}
          {matches("Permissions") && (
            <MenuItem label="Permissions" description="Opens settings.json" onClick={() => act(props.onOpenSettingsJson, props.onClose)} />
          )}
          {matches("Memory") && <MenuItem label="Memory" description="Opens CLAUDE.md" onClick={() => act(props.onOpenClaudeMd, props.onClose)} />}
          {matches("Manage plugins") && (
            <MenuItem label="Reload plugins" onClick={() => act(props.onReloadPlugins, props.onClose)} />
          )}
          {matches("Open Claude in Terminal") && (
            <MenuItem label="Open Claude in Terminal" onClick={() => act(props.onOpenClaudeInTerminal, props.onClose)} />
          )}
        </>
      ),
    },
    {
      key: "settings",
      visible: settingsVisible,
      render: () => (
        <>
          <MenuSectionLabel>Settings</MenuSectionLabel>
          {matches("General config") && (
            <MenuItem label="General config..." onClick={() => act(props.onOpenSettingsJson, props.onClose)} />
          )}
          {matches("Focus view") && (
            <ToggleRow label="Focus view" checked={props.focusView} onToggle={props.onToggleFocusView} />
          )}
        </>
      ),
    },
    {
      key: "support",
      visible: supportVisible,
      render: () => (
        <>
          <MenuSectionLabel>Support</MenuSectionLabel>
          {matches("View help docs") && (
            <MenuItem
              label="View help docs"
              onClick={() => act(() => props.onOpenExternalUrl("https://docs.claude.com/en/docs/claude-code"), props.onClose)}
            />
          )}
          {matches("Report a problem") && (
            <MenuItem
              label="Report a problem"
              onClick={() => act(() => props.onOpenExternalUrl("https://github.com/anthropics/claude-code/issues"), props.onClose)}
            />
          )}
        </>
      ),
    },
    {
      key: "matchingCommands",
      visible: matchingCommands.length > 0,
      render: () => (
        <>
          <MenuSectionLabel>Slash Commands</MenuSectionLabel>
          {matchingCommands.map((command) => (
            <MenuItem
              key={command.name}
              label={`/${command.name}`}
              description={command.description}
              onClick={() => act(() => props.onInsertCommand(command.name), props.onClose)}
            />
          ))}
        </>
      ),
    },
    {
      key: "matchingMcpServers",
      visible: matchingMcpServers.length > 0,
      render: () => (
        <>
          <MenuSectionLabel>MCP servers</MenuSectionLabel>
          {matchingMcpServers.map((server) => (
            <MenuItem key={server.name} label={server.name} description={server.status} onClick={() => goTo("mcp")} />
          ))}
        </>
      ),
    },
    {
      key: "matchingAgents",
      visible: matchingAgents.length > 0,
      render: () => (
        <>
          <MenuSectionLabel>Agents</MenuSectionLabel>
          {matchingAgents.map((agent) => (
            <MenuItem key={agent.name} label={agent.name} description={agent.description} />
          ))}
        </>
      ),
    },
    {
      key: "matchingSkills",
      visible: matchingSkills.length > 0,
      render: () => (
        <>
          <MenuSectionLabel>Skills</MenuSectionLabel>
          {matchingSkills.map((skill) => (
            <MenuItem key={skill.name} label={skill.name} description={skill.description} />
          ))}
        </>
      ),
    },
  ];
  const visibleRootSections = rootSections.filter((s) => s.visible);

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 max-h-[28rem] w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
      <input
        autoFocus
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onClose();
        }}
        placeholder="Filter actions..."
        className="w-full border-b border-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none"
      />
      <div className="p-1">
        {view === "root" && (
          <>
            {visibleRootSections.length === 0 && <EmptyRow message="No matches" />}
            {visibleRootSections.map((section, i) => (
              <Fragment key={section.key}>
                {i > 0 && <MenuDivider />}
                {section.render()}
              </Fragment>
            ))}
          </>
        )}

        {view === "model" && (
          <BackList title="Select a model" onBack={() => setView("root")}>
            {props.models.map((model) => (
              <MenuItem
                key={model.value}
                label={model.displayName}
                description={model.description}
                selected={model.value === props.selectedModel}
                onClick={() => act(() => props.onModelChange(model.value), props.onClose)}
              />
            ))}
          </BackList>
        )}

        {view === "outputStyles" && (
          <BackList title="Output styles" onBack={() => setView("root")}>
            {props.outputStyles.length === 0 && <EmptyRow />}
            {props.outputStyles.map((style) => (
              <MenuItem key={style} label={style} onClick={() => act(() => props.onSetOutputStyle(style), props.onClose)} />
            ))}
          </BackList>
        )}

        {view === "agents" && (
          <BackList title="Agents" onBack={() => setView("root")}>
            {props.agents.length === 0 && <EmptyRow />}
            {props.agents.map((agent) => (
              <MenuItem key={agent.name} label={agent.name} description={agent.description} />
            ))}
          </BackList>
        )}

        {view === "mcp" && (
          <BackList title="MCP servers" onBack={() => setView("root")}>
            {addingServer ? (
              <div className="flex flex-col gap-1.5 px-2 py-1.5">
                <input
                  autoFocus
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="Server name"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none"
                />
                <input
                  value={newServerCommand}
                  onChange={(e) => setNewServerCommand(e.target.value)}
                  placeholder="Command (e.g. npx)"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none"
                />
                <input
                  value={newServerArgs}
                  onChange={(e) => setNewServerArgs(e.target.value)}
                  placeholder="Args, space-separated (optional)"
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={submitNewServer} disabled={!newServerName.trim() || !newServerCommand.trim()}>
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAddingServer(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <MenuItem
                icon={<Plus size={14} />}
                label="Add server..."
                description="stdio only — for HTTP/SSE, use .mcp.json"
                onClick={() => setAddingServer(true)}
              />
            )}
            <MenuDivider />
            {props.mcpServers.length === 0 && <EmptyRow />}
            {props.mcpServers.map((server) => (
              <MenuItem
                key={server.name}
                label={server.name}
                description={server.status}
                trailing={
                  <span className="flex items-center gap-2">
                    {(server.status === "failed" || server.status === "needs-auth") && (
                      <Tooltip label="Reconnect">
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onReconnectMcpServer(server.name);
                          }}
                          className="text-muted hover:text-foreground"
                        >
                          <RefreshCw size={12} />
                        </span>
                      </Tooltip>
                    )}
                    <Tooltip label="Per-server permission override — tighten-only; only takes effect when the session mode would already auto-allow">
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          cycleMcpOverride(server.name);
                        }}
                        className="text-muted hover:text-foreground"
                      >
                        Override: {mcpOverrides[server.name] ?? "—"}
                      </span>
                    </Tooltip>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onToggleMcpServer(server.name, !server.enabled);
                      }}
                      className={server.enabled ? "text-accent" : "text-muted"}
                    >
                      {server.enabled ? "On" : "Off"}
                    </span>
                  </span>
                }
              />
            ))}
          </BackList>
        )}

        {view === "commands" && (
          <BackList title="Slash commands" onBack={() => setView("root")}>
            {props.slashCommands.length === 0 && <EmptyRow />}
            {props.slashCommands.map((command) => (
              <MenuItem
                key={command.name}
                label={`/${command.name}`}
                description={command.description}
                onClick={() => act(() => props.onInsertCommand(command.name), props.onClose)}
              />
            ))}
          </BackList>
        )}

        {view === "skills" && (
          <BackList title="Skills" onBack={() => setView("root")}>
            {props.skills.length === 0 && <EmptyRow />}
            {props.skills.map((skill) => (
              <MenuItem key={skill.name} label={skill.name} description={skill.description} />
            ))}
          </BackList>
        )}

        {view === "account" && (
          <BackList title="Account & usage" onBack={() => setView("root")}>
            {!props.account && <EmptyRow />}
            {props.account && (
              <div className="px-2 py-1.5 text-sm text-foreground">
                <div>{props.account.email ?? "Unknown account"}</div>
                {props.account.organization && <div className="text-xs text-muted">{props.account.organization}</div>}
              </div>
            )}
          </BackList>
        )}
      </div>
    </div>
  );
}

function act(action: () => void, close: () => void): void {
  action();
  close();
}

function currentModelLabel(props: SlashPaletteProps): string {
  return props.models.find((m) => m.value === props.selectedModel)?.displayName ?? "";
}

function BackList({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <>
      <button onClick={onBack} className="flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-surface-hover">
        <ChevronLeft size={14} className="text-muted" /> {title}
      </button>
      <MenuDivider />
      {children}
    </>
  );
}

function EmptyRow({ message = "Loading..." }: { message?: string }) {
  return <div className="px-2 py-2 text-xs text-muted">{message}</div>;
}

function ToggleRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-surface-hover">
      <span className="text-sm text-foreground">{label}</span>
      <span className={checked ? "h-4 w-7 rounded-full bg-accent p-0.5" : "h-4 w-7 rounded-full bg-border p-0.5"}>
        <span
          className={
            checked
              ? "block h-3 w-3 translate-x-3 rounded-full bg-accent-foreground transition-transform"
              : "block h-3 w-3 translate-x-0 rounded-full bg-accent-foreground transition-transform"
          }
        />
      </span>
    </button>
  );
}
