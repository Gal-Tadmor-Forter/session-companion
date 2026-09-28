import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { EffortLevelId, ModelOption } from "../../../shared/protocol";
import { Popover } from "../components/Popover";
import { MenuItem } from "../components/MenuItem";
import { EffortSlider } from "../components/EffortSlider";

interface ModelPickerProps {
  models: ModelOption[];
  selectedModel: string;
  effort: EffortLevelId;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: EffortLevelId) => void;
  /** `requestModels` is only ever fired once, at app mount — if that round trip hadn't
   * come back yet (or was lost) by the time this opens, re-request so the popover
   * self-heals instead of staying permanently blank. */
  onRequestModels: () => void;
}

export function ModelPicker({
  models,
  selectedModel,
  effort,
  onModelChange,
  onEffortChange,
  onRequestModels,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const current = models.find((m) => m.value === selectedModel);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && models.length === 0) {
          onRequestModels();
        }
      }}
      anchor={
        <button
          title="Model and effort"
          className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-foreground hover:bg-surface-hover"
        >
          <Sparkles size={13} className="text-accent" />
          {current?.displayName ?? "Model"}
          <span className="text-muted">{capitalize(effort)}</span>
        </button>
      }
    >
      {models.length === 0 && <div className="px-2 py-2 text-xs text-muted">Loading models…</div>}
      {models.map((model) => (
        <MenuItem
          key={model.value}
          label={model.displayName}
          description={model.description}
          selected={model.value === selectedModel}
          onClick={() => {
            onModelChange(model.value);
            setOpen(false);
          }}
        />
      ))}
      {current?.supportsEffort && (
        <>
          <div className="my-1 border-t border-border" />
          <EffortSlider value={effort} onChange={onEffortChange} />
        </>
      )}
    </Popover>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
