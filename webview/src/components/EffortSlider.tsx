import type { EffortLevelId } from "../../../shared/protocol";

const LEVELS: EffortLevelId[] = ["low", "medium", "high", "xhigh", "max"];

interface EffortSliderProps {
  value: EffortLevelId;
  onChange: (value: EffortLevelId) => void;
}

export function EffortSlider({ value, onChange }: EffortSliderProps) {
  const index = Math.max(0, LEVELS.indexOf(value));
  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="text-sm text-foreground">
        Effort <span className="text-muted">({capitalize(value)})</span>
      </span>
      <div className="flex items-center gap-1">
        {LEVELS.map((level, i) => (
          <button
            key={level}
            onClick={() => onChange(level)}
            aria-label={`Effort ${level}`}
            className={
              i <= index
                ? "h-2 w-4 rounded-full bg-accent"
                : "h-2 w-4 rounded-full bg-border hover:bg-surface-hover"
            }
          />
        ))}
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
