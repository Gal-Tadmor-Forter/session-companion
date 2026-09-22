export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatRelativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Just now";
  if (diffMs < hour) {
    const m = Math.floor(diffMs / minute);
    return `${m} min${m === 1 ? "" : "s"} ago`;
  }
  if (diffMs < day) {
    const h = Math.floor(diffMs / hour);
    return `${h} hr${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(diffMs / day);
  if (d === 1) return "1 day ago";
  return `${d} days ago`;
}

export type DateGroup = "Today" | "Yesterday" | "This week" | "Earlier";

export function dateGroupFor(ms: number): DateGroup {
  const now = new Date();
  const date = new Date(ms);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const todayStart = startOfDay(now);
  const dateStart = startOfDay(date);
  const dayMs = 24 * 60 * 60 * 1000;

  if (dateStart === todayStart) return "Today";
  if (dateStart === todayStart - dayMs) return "Yesterday";
  if (todayStart - dateStart < 7 * dayMs) return "This week";
  return "Earlier";
}

export const DATE_GROUP_ORDER: DateGroup[] = ["Today", "Yesterday", "This week", "Earlier"];
