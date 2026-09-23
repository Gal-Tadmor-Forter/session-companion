import { useEffect, useState } from "react";

// Same frames/interval as ora's default "dots" spinner — ora itself can't run here (it
// writes ANSI escapes to `process.stderr` via Node's `readline`, neither of which exist
// in this browser-bundled webview), so this just reproduces its look with a plain timer.
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export function Spinner({ className }: { className?: string }) {
  const [frameIndex, setFrameIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrameIndex((i) => (i + 1) % FRAMES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={className} aria-hidden="true">
      {FRAMES[frameIndex]}
    </span>
  );
}
