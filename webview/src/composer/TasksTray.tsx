import { useState } from "react";
import { ListTodo, Square } from "lucide-react";
import type { BackgroundTaskEntry } from "../../../shared/protocol";
import { Popover } from "../components/Popover";
import { MenuItem } from "../components/MenuItem";
import { Tooltip } from "../components/Tooltip";

interface TasksTrayProps {
  tasks: BackgroundTaskEntry[];
  onStopTask: (taskId: string) => void;
}

/** A small badge that only appears once something is actually running in the
 * background (Query.backgroundTasks) — nothing to show otherwise. */
export function TasksTray({ tasks, onStopTask }: TasksTrayProps) {
  const [open, setOpen] = useState(false);
  if (tasks.length === 0) {
    return null;
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      anchor={
        <button
          title="Background tasks"
          className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-foreground hover:bg-surface-hover"
        >
          <ListTodo size={13} className="text-accent" />
          {tasks.length}
        </button>
      }
    >
      <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted">Running in background</div>
      <div className="px-2 pb-2 text-[11px] text-muted">Click the square to stop a task.</div>
      {tasks.map((task) => (
        <MenuItem
          key={task.taskId}
          label={task.description}
          // Show live progress once one arrives (proof the task is actually moving,
          // not hung) — falls back to the static task type until the first
          // `task_progress` tick lands.
          description={task.progressSummary ?? task.taskType}
          trailing={
            <Tooltip label="Stop">
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onStopTask(task.taskId);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    onStopTask(task.taskId);
                  }
                }}
                className="mt-0.5 flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-border p-1 text-muted hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
              >
                <Square size={12} />
              </span>
            </Tooltip>
          }
        />
      ))}
    </Popover>
  );
}
