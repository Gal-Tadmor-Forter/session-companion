import { useState } from "react";
import { Hand, Code2, ClipboardList, Zap, BellOff, ShieldOff, type LucideIcon } from "lucide-react";
import type { PermissionModeId } from "../../../shared/protocol";
import { Popover } from "../components/Popover";
import { MenuItem } from "../components/MenuItem";
import { MenuDivider } from "../components/MenuItem";

// `bypassPermissions` is intentionally NOT part of this array (and so never part of
// cycleMode's rotation, if that's ever wired to a shortcut) — it's rendered as its own
// item below with a distinct handler that routes through a host-side confirmation
// dialog, since selecting it can't be an optimistic one-click action like the others.
const MODES: { value: PermissionModeId; label: string; icon: LucideIcon; description: string }[] = [
  { value: "default", label: "Manual", icon: Hand, description: "Claude will ask for approval before making each edit" },
  {
    value: "dontAsk",
    label: "Don't ask",
    icon: BellOff,
    description: "Claude won't prompt for permission — anything not already approved is denied",
  },
  { value: "acceptEdits", label: "Edit automatically", icon: Code2, description: "Claude will edit your selected text or the whole file" },
  { value: "plan", label: "Plan", icon: ClipboardList, description: "Claude will explore the code and present a plan before editing" },
  { value: "auto", label: "Auto", icon: Zap, description: "Claude will approve actions that pass a safety check and pause for anything risky" },
];

const BYPASS_MODE = {
  value: "bypassPermissions" as const,
  label: "Full bypass",
  icon: ShieldOff,
  description: "Skips every permission check — no prompts, no safety classifier. Requires confirmation to enable.",
};

interface ModePickerProps {
  mode: PermissionModeId;
  /** True when the org's `permissions.disableBypassPermissionsMode` policy blocks Full
   * Bypass — hides the option entirely rather than letting the user pick it and then
   * fail. Resolved host-side; see `App.tsx`'s `bypassPermissionsDisabled` state. */
  bypassPermissionsDisabled: boolean;
  onModeChange: (mode: PermissionModeId) => void;
  onRequestBypassPermissions: () => void;
}

export function ModePicker({ mode, bypassPermissionsDisabled, onModeChange, onRequestBypassPermissions }: ModePickerProps) {
  const [open, setOpen] = useState(false);
  const current = mode === "bypassPermissions" ? BYPASS_MODE : MODES.find((m) => m.value === mode) ?? MODES[0];

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      anchor={
        <button
          title="Permission mode"
          className={
            mode === "bypassPermissions"
              ? "flex items-center gap-1 rounded-full border border-danger/40 bg-danger/10 px-2.5 py-1 text-xs text-danger hover:bg-danger/20"
              : "flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-foreground hover:bg-surface-hover"
          }
        >
          <current.icon size={13} />
          {current.label}
        </button>
      }
    >
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <span className="text-xs font-medium text-muted">Modes</span>
        <span className="text-xs text-muted">⇧+Tab to switch</span>
      </div>
      {MODES.map((m) => (
        <MenuItem
          key={m.value}
          icon={<m.icon size={14} />}
          label={m.label}
          description={m.description}
          selected={m.value === mode}
          onClick={() => {
            onModeChange(m.value);
            setOpen(false);
          }}
        />
      ))}
      {!bypassPermissionsDisabled && (
        <>
          <MenuDivider />
          <MenuItem
            icon={<ShieldOff size={14} className="text-danger" />}
            label={BYPASS_MODE.label}
            description={BYPASS_MODE.description}
            selected={mode === "bypassPermissions"}
            onClick={() => {
              onRequestBypassPermissions();
              setOpen(false);
            }}
          />
        </>
      )}
    </Popover>
  );
}

export function cycleMode(current: PermissionModeId): PermissionModeId {
  const index = MODES.findIndex((m) => m.value === current);
  const next = MODES[(index + 1) % MODES.length];
  return next.value;
}
