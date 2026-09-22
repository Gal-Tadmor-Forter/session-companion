import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateGroupFor, formatClockTime, formatRelativeTime } from "../relativeTime";

describe("formatClockTime", () => {
  it("returns a non-empty time-of-day string", () => {
    const formatted = formatClockTime(new Date(2026, 0, 1, 14, 5).getTime());
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("formatRelativeTime", () => {
  const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says 'Just now' for anything under a minute old", () => {
    expect(formatRelativeTime(NOW - 30_000)).toBe("Just now");
  });

  it("pluralizes minutes correctly", () => {
    expect(formatRelativeTime(NOW - 60_000)).toBe("1 min ago");
    expect(formatRelativeTime(NOW - 5 * 60_000)).toBe("5 mins ago");
  });

  it("pluralizes hours correctly", () => {
    expect(formatRelativeTime(NOW - 60 * 60_000)).toBe("1 hr ago");
    expect(formatRelativeTime(NOW - 3 * 60 * 60_000)).toBe("3 hrs ago");
  });

  it("says '1 day ago' for exactly one day", () => {
    expect(formatRelativeTime(NOW - 24 * 60 * 60_000)).toBe("1 day ago");
  });

  it("pluralizes multiple days", () => {
    expect(formatRelativeTime(NOW - 3 * 24 * 60 * 60_000)).toBe("3 days ago");
  });
});

describe("dateGroupFor", () => {
  const NOW = new Date(2026, 0, 15, 12, 0, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups a timestamp from earlier today as Today", () => {
    expect(dateGroupFor(new Date(2026, 0, 15, 1, 0, 0).getTime())).toBe("Today");
  });

  it("groups yesterday's timestamp as Yesterday", () => {
    expect(dateGroupFor(new Date(2026, 0, 14, 23, 0, 0).getTime())).toBe("Yesterday");
  });

  it("groups a timestamp from earlier this week as 'This week'", () => {
    expect(dateGroupFor(new Date(2026, 0, 10, 12, 0, 0).getTime())).toBe("This week");
  });

  it("groups anything older than a week as Earlier", () => {
    expect(dateGroupFor(new Date(2026, 0, 1, 12, 0, 0).getTime())).toBe("Earlier");
  });
});
