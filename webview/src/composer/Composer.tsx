import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { Image, FileText, Send, X } from "lucide-react";
import type {
  AccountInfoResult,
  AgentInfoEntry,
  AttachmentSummary,
  BackgroundTaskEntry,
  ContextUsageInfo,
  EffortLevelId,
  FileMentionResult,
  McpServerStatusEntry,
  MessageDeliveryMode,
  ModelOption,
  NewMcpServerConfig,
  PermissionModeId,
  SlashCommandEntry,
} from "../../../shared/protocol";
import { Button } from "../components/Button";
import { Tooltip } from "../components/Tooltip";
import { ModelPicker } from "./ModelPicker";
import { ModePicker } from "./ModePicker";
import { AttachMenu } from "./AttachMenu";
import { MentionAutocomplete } from "./MentionAutocomplete";
import { SlashCommandAutocomplete } from "./SlashCommandAutocomplete";
import { SlashPalette } from "./SlashPalette";
import { SendMenu } from "./SendMenu";
import { ContextGauge } from "./ContextGauge";
import { TasksTray } from "./TasksTray";

interface ComposerProps {
  sending: boolean;
  models: ModelOption[];
  selectedModel: string;
  permissionMode: PermissionModeId;
  bypassPermissionsDisabled: boolean;
  effort: EffortLevelId;
  attachments: AttachmentSummary[];
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  mentionResults: FileMentionResult[];
  mcpServers: McpServerStatusEntry[];
  agents: AgentInfoEntry[];
  slashCommands: SlashCommandEntry[];
  outputStyles: string[];
  account: AccountInfoResult | undefined;
  focusView: boolean;
  pendingMentionInserts: FileMentionResult[];
  onMentionInsertsConsumed: () => void;
  onSend: (text: string, deliveryMode?: MessageDeliveryMode) => void;
  onStop: () => void;
  onModelChange: (model: string) => void;
  onPermissionModeChange: (mode: PermissionModeId) => void;
  onRequestBypassPermissions: () => void;
  onEffortChange: (effort: EffortLevelId) => void;
  onAttachFiles: () => void;
  onAttachDroppedFile: (fileName: string, base64Data: string) => void;
  onResolveWorkspacePath: (absolutePath: string) => void;
  onRemoveAttachment: (id: string) => void;
  onPreviewAttachment: (attachment: AttachmentSummary) => void;
  onToggleWebSearch: () => void;
  onToggleThinking: () => void;
  onRequestMentions: (query: string) => void;
  onClearConversation: () => void;
  onRewind: () => void;
  onAddDirectory: () => void;
  onRequestMcpServers: () => void;
  onToggleMcpServer: (name: string, enabled: boolean) => void;
  onReconnectMcpServer: (name: string) => void;
  onSetMcpPermissionModeOverride: (name: string, mode: "default" | "auto" | null) => void;
  onAddMcpServer: (name: string, config: NewMcpServerConfig) => void;
  backgroundTasks: BackgroundTaskEntry[];
  onStopTask: (taskId: string) => void;
  onRequestAgents: () => void;
  onRequestSlashCommands: () => void;
  skills: SlashCommandEntry[];
  onRequestSkills: () => void;
  canFork: boolean;
  onForkSession: () => void;
  onRequestOutputStyles: () => void;
  onSetOutputStyle: (style: string) => void;
  onRequestAccountInfo: () => void;
  onToggleFocusView: () => void;
  onOpenClaudeMd: () => void;
  onOpenSettingsJson: () => void;
  onReloadPlugins: () => void;
  onOpenClaudeInTerminal: () => void;
  onOpenExternalUrl: (url: string) => void;
  contextUsage: ContextUsageInfo | undefined;
  onCompact: () => void;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function Composer(props: ComposerProps) {
  const {
    sending,
    models,
    selectedModel,
    permissionMode,
    bypassPermissionsDisabled,
    effort,
    attachments,
    webSearchEnabled,
    mentionResults,
    onSend,
    onStop,
    onModelChange,
    onPermissionModeChange,
    onRequestBypassPermissions,
    onEffortChange,
    onAttachFiles,
    onAttachDroppedFile,
    onResolveWorkspacePath,
    onRemoveAttachment,
    onPreviewAttachment,
    onToggleWebSearch,
    onRequestMentions,
    pendingMentionInserts,
    onMentionInsertsConsumed,
  } = props;

  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // "" means the bare "/" (open the full command palette); any other string is a
  // slash-command prefix being typed (inline autocomplete narrows to matches).
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    if (pendingMentionInserts.length === 0) {
      return;
    }
    const mentions = pendingMentionInserts.map((m) => `@${m.relativePath}`).join(" ");
    setText((t) => (t && !t.endsWith(" ") && !t.endsWith("\n") ? `${t} ${mentions} ` : `${t}${mentions} `));
    onMentionInsertsConsumed();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [pendingMentionInserts, onMentionInsertsConsumed]);

  const submit = (deliveryMode?: MessageDeliveryMode) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    if (sending && !deliveryMode) {
      // A plain Send while a turn is running has no natural meaning here —
      // the composer only offers a delivery mode via the SendMenu/Enter/Alt+Enter.
      return;
    }
    onSend(trimmed, deliveryMode);
    setText("");
    setMentionQuery(null);
    setSlashQuery(null);
  };

  const handleChange = (value: string) => {
    setText(value);
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const upToCursor = value.slice(0, cursor);

    const atMatch = /@([^\s@]*)$/.exec(upToCursor);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      onRequestMentions(atMatch[1]);
    } else {
      setMentionQuery(null);
    }

    // A slash command only makes sense as the very first (and so far only) token
    // of the message — once anything else follows, "/" is just a character.
    const slashMatch = /^\/(\S*)$/.exec(value);
    setSlashQuery(slashMatch ? slashMatch[1] : null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (sending) {
        submit(event.altKey ? "queue" : "steer");
      } else {
        submit();
      }
    } else if (event.key === "Escape") {
      setMentionQuery(null);
      setSlashQuery(null);
    }
  };

  const insertMention = (result: FileMentionResult) => {
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    const upToCursor = text.slice(0, cursor);
    const replaced = upToCursor.replace(/@([^\s@]*)$/, `@${result.relativePath} `);
    const next = replaced + text.slice(cursor);
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const insertSlashCommand = (name: string) => {
    setText(`/${name} `);
    setSlashQuery(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const matchingSlashCommands =
    slashQuery !== null && slashQuery.length > 0
      ? props.slashCommands.filter((c) => c.name.toLowerCase().startsWith(slashQuery.toLowerCase()))
      : [];

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    // A copied file (e.g. from Finder, or an image copied from a browser/screenshot
    // tool) shows up as a File on the clipboard — treat it exactly like a dropped
    // file. Plain-text paste has no files here, so it falls through to the
    // textarea's default paste behavior untouched.
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    for (const file of files) {
      // A pasted screenshot/clipboard image typically arrives with an empty
      // `name` (unlike a real dropped file), so fall back to a generated one.
      const fileName = file.name || `pasted-${Date.now()}.${file.type.split("/")[1] ?? "png"}`;
      readFileAsBase64(file)
        .then((base64Data) => onAttachDroppedFile(fileName, base64Data))
        .catch(() => undefined);
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounter.current += 1;
    setIsDraggingOver(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounter.current = 0;
    setIsDraggingOver(false);

    // A real OS file (dragged from Finder/Explorer, or VS Code's own Explorer for an
    // item outside the workspace) comes through as an actual File with readable bytes
    // — treat it as an upload, identically to "Upload from computer".
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      for (const file of files) {
        readFileAsBase64(file)
          .then((base64Data) => onAttachDroppedFile(file.name, base64Data))
          .catch(() => undefined);
      }
      return;
    }

    // Dragging a file from VS Code's own Explorer/editor tabs doesn't populate `files`
    // (there's no real OS-level drag) — VS Code instead sets the file:// URI(s) on the
    // standard uri-list type. Since it's already in the workspace, mention it by path
    // instead of attaching its bytes.
    const uriList = event.dataTransfer.getData("text/uri-list");
    if (!uriList) {
      return;
    }
    for (const line of uriList.split("\n")) {
      const uri = line.trim();
      if (!uri || uri.startsWith("#") || !uri.startsWith("file://")) {
        continue;
      }
      const absolutePath = decodeURIComponent(uri.replace(/^file:\/\//, ""));
      onResolveWorkspacePath(absolutePath);
    }
  };

  return (
    <div
      className={
        isDraggingOver
          ? "relative flex flex-col gap-2 rounded-xl border border-dashed border-accent bg-accent/10 p-2"
          : "relative flex flex-col gap-2 rounded-xl border border-border bg-surface/40 p-2"
      }
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {slashQuery === "" && (
        <SlashPalette
          onClose={() => setSlashQuery(null)}
          models={models}
          selectedModel={selectedModel}
          effort={effort}
          onModelChange={onModelChange}
          onEffortChange={onEffortChange}
          thinkingEnabled={props.thinkingEnabled}
          onToggleThinking={props.onToggleThinking}
          outputStyles={props.outputStyles}
          onRequestOutputStyles={props.onRequestOutputStyles}
          onSetOutputStyle={props.onSetOutputStyle}
          agents={props.agents}
          onRequestAgents={props.onRequestAgents}
          mcpServers={props.mcpServers}
          onRequestMcpServers={props.onRequestMcpServers}
          onToggleMcpServer={props.onToggleMcpServer}
          onReconnectMcpServer={props.onReconnectMcpServer}
          onSetMcpPermissionModeOverride={props.onSetMcpPermissionModeOverride}
          onAddMcpServer={props.onAddMcpServer}
          slashCommands={props.slashCommands}
          onRequestSlashCommands={props.onRequestSlashCommands}
          onInsertCommand={insertSlashCommand}
          skills={props.skills}
          onRequestSkills={props.onRequestSkills}
          account={props.account}
          onRequestAccountInfo={props.onRequestAccountInfo}
          focusView={props.focusView}
          onToggleFocusView={props.onToggleFocusView}
          onAttachFile={onAttachFiles}
          onMentionFile={() => {
            setText((t) => `${t}@`);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          onClearConversation={props.onClearConversation}
          onRewind={props.onRewind}
          onAddDirectory={props.onAddDirectory}
          canFork={props.canFork}
          onForkSession={props.onForkSession}
          onOpenClaudeMd={props.onOpenClaudeMd}
          onOpenSettingsJson={props.onOpenSettingsJson}
          onReloadPlugins={props.onReloadPlugins}
          onOpenClaudeInTerminal={props.onOpenClaudeInTerminal}
          onOpenExternalUrl={props.onOpenExternalUrl}
        />
      )}
      {slashQuery !== null && slashQuery.length > 0 && (
        <div className="absolute bottom-full left-2 mb-1">
          <SlashCommandAutocomplete
            commands={matchingSlashCommands}
            onSelect={(command) => insertSlashCommand(command.name)}
          />
        </div>
      )}
      {mentionQuery !== null && slashQuery === null && (
        <div className="absolute bottom-full left-2 mb-1">
          <MentionAutocomplete results={mentionResults} onSelect={insertMention} />
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <span
              key={att.id ?? att.fileName}
              className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted"
            >
              <Tooltip label="Click to view">
                <button
                  onClick={() => onPreviewAttachment(att)}
                  className="flex cursor-pointer items-center gap-1 hover:text-foreground"
                >
                  {att.kind === "image" ? <Image size={12} /> : <FileText size={12} />} {att.fileName}
                </button>
              </Tooltip>
              <Tooltip label={`Remove ${att.fileName}`}>
                <button
                  onClick={() => att.id && onRemoveAttachment(att.id)}
                  className="ml-0.5 cursor-pointer text-muted hover:text-foreground"
                  aria-label={`Remove ${att.fileName}`}
                >
                  <X size={12} />
                </button>
              </Tooltip>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={
          isDraggingOver
            ? "Drop to attach or mention this file"
            : "Describe what to build, @ to mention a file, / for commands"
        }
        rows={3}
        className="w-full resize-none rounded-md border border-transparent bg-transparent p-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none"
      />
      {sending && text.trim() && (
        <div className="px-1.5 text-[11px] text-muted">Enter to steer this response · ⌥Enter to queue for after</div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <AttachMenu
          webSearchEnabled={webSearchEnabled}
          onUpload={onAttachFiles}
          onMentionFile={() => {
            setText((t) => `${t}@`);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          onToggleWebSearch={onToggleWebSearch}
        />
        <ModePicker
          mode={permissionMode}
          bypassPermissionsDisabled={bypassPermissionsDisabled}
          onModeChange={onPermissionModeChange}
          onRequestBypassPermissions={onRequestBypassPermissions}
        />
        <ModelPicker
          models={models}
          selectedModel={selectedModel}
          effort={effort}
          onModelChange={onModelChange}
          onEffortChange={onEffortChange}
        />
        {props.contextUsage && (
          <ContextGauge usage={props.contextUsage} onCompact={props.onCompact} disabled={sending} />
        )}
        <TasksTray tasks={props.backgroundTasks} onStopTask={props.onStopTask} />
        <div className="ml-auto">
          {sending ? (
            <SendMenu
              hasDraft={Boolean(text.trim())}
              onStop={onStop}
              onStopAndSend={() => submit("stopAndSend")}
              onQueue={() => submit("queue")}
              onSteer={() => submit("steer")}
            />
          ) : (
            <Button onClick={() => submit()} disabled={!text.trim()} className="flex cursor-pointer items-center gap-1.5">
              <Send size={14} /> Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
