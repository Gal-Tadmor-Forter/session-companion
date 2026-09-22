import { describe, expect, it } from "vitest";
import { formatTokenCount } from "../formatTokenCount";

describe("formatTokenCount", () => {
  it("returns raw digits under 1,000", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats thousands with a K suffix", () => {
    expect(formatTokenCount(1_000)).toBe("1K");
    expect(formatTokenCount(1_500)).toBe("1.5K");
    expect(formatTokenCount(381_600)).toBe("381.6K");
  });

  it("formats millions with an M suffix", () => {
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
  });
});
