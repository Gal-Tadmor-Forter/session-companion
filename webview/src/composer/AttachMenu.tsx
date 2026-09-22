import { useState } from "react";
import { Plus, Upload, FileText, Globe } from "lucide-react";
import { Popover } from "../components/Popover";
import { MenuItem } from "../components/MenuItem";

interface AttachMenuProps {
  webSearchEnabled: boolean;
  onUpload: () => void;
  onMentionFile: () => void;
  onToggleWebSearch: () => void;
}

export function AttachMenu({ webSearchEnabled, onUpload, onMentionFile, onToggleWebSearch }: AttachMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      anchor={
        <button
          title="Attach"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground"
        >
          <Plus size={16} />
        </button>
      }
      className="w-64"
    >
      <MenuItem
        icon={<Upload size={14} />}
        label="Upload from computer"
        onClick={() => {
          onUpload();
          setOpen(false);
        }}
      />
      <MenuItem
        icon={<FileText size={14} />}
        label="Add context"
        description="Mention a file from this project, or hold ⇧ and drag one in from Explorer"
        onClick={() => {
          onMentionFile();
          setOpen(false);
        }}
      />
      <MenuItem
        icon={<Globe size={14} />}
        label="Browse the web"
        selected={webSearchEnabled}
        onClick={() => {
          onToggleWebSearch();
          setOpen(false);
        }}
      />
    </Popover>
  );
}
