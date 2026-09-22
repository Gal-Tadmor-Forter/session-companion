import { useState } from "react";
import { Square, ArrowRight, Plus, CornerDownLeft, ChevronDown } from "lucide-react";
import { Popover } from "../components/Popover";
import { MenuItem } from "../components/MenuItem";

interface SendMenuProps {
  hasDraft: boolean;
  onStop: () => void;
  onStopAndSend: () => void;
  onQueue: () => void;
  onSteer: () => void;
}

/** Shown in place of the Send button while a turn is in progress — lets the
 * user interrupt, or send a new message without losing the current response.
 * A split button, not a plain menu trigger: the main half is a direct "Stop"
 * action (the default/expected click, same as Copilot's equivalent control),
 * the chevron half opens the menu for the other delivery modes. */
export function SendMenu({ hasDraft, onStop, onStopAndSend, onQueue, onSteer }: SendMenuProps) {
  const [open, setOpen] = useState(false);

  const act = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      interactive={false}
      anchor={
        <div className="flex items-center overflow-hidden rounded-full border border-border bg-surface text-xs text-foreground">
          <button
            onClick={onStop}
            title="Stop responding"
            className="flex cursor-pointer items-center gap-1 py-1 pl-2.5 pr-1.5 hover:bg-surface-hover"
          >
            <Square size={11} />
            Stop
          </button>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="More response options"
            className="flex cursor-pointer items-center border-l border-border py-1 pl-1 pr-2 hover:bg-surface-hover"
          >
            <ChevronDown size={12} />
          </button>
        </div>
      }
      className="w-56"
    >
      <MenuItem icon={<Square size={14} />} label="Stop" onClick={() => act(onStop)} />
      <MenuItem
        icon={<ArrowRight size={14} />}
        label="Stop and Send"
        disabled={!hasDraft}
        onClick={() => act(onStopAndSend)}
      />
      <MenuItem
        icon={<Plus size={14} />}
        label="Add to Queue"
        trailing={<span className="text-xs text-muted">⌥Enter</span>}
        disabled={!hasDraft}
        onClick={() => act(onQueue)}
      />
      <MenuItem
        icon={<CornerDownLeft size={14} />}
        label="Steer with Message"
        trailing={<span className="text-xs text-muted">Enter</span>}
        disabled={!hasDraft}
        onClick={() => act(onSteer)}
      />
    </Popover>
  );
}
