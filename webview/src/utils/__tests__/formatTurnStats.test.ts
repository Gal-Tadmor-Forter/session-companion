import { describe, expect, it } from "vitest";
import { formatCost, formatDuration } from "../formatTurnStats";

describe("formatDuration", () => {
  it("formats sub-second durations in milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats sub-minute durations in seconds with one decimal", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(2073)).toBe("2.1s");
    expect(formatDuration(59999)).toBe("60.0s");
  });

  it("formats minute-plus durations as Nm Ns", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(72_000)).toBe("1m 12s");
    expect(formatDuration(3_600_000)).toBe("60m 0s");
  });

  it("rounds the total seconds before splitting into minutes/seconds, not each part separately", () => {
    // 119.6s naively rounds to "1m 60s" (minutes=floor(119.6/60)=1, seconds=round(59.6)=60).
    // Rounding the total first (120) avoids that: 2m 0s.
    expect(formatDuration(119_600)).toBe("2m 0s");
  });
});

describe("formatCost", () => {
  it("formats zero and negative costs as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(-0.01)).toBe("$0.00");
  });

  it("uses 4 decimal places for sub-cent costs", () => {
    expect(formatCost(0.0001)).toBe("$0.0001");
    expect(formatCost(0.0074)).toBe("$0.0074");
  });

  it("uses 2 decimal places at a cent or above", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(0.1375)).toBe("$0.14");
    expect(formatCost(12.5)).toBe("$12.50");
  });
});
