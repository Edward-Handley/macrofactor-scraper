export function fmt(value: number | null | undefined, decimals = 0): string {
  if (value == null) return "-";
  return value.toLocaleString("en", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function compact(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function formatMinutesAsHoursMinutes(value: number | null | undefined): string {
  if (value == null) return "-";
  const totalMinutes = Math.max(0, Math.round(value));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function minutesToDecimalHours(value: number): number {
  return Math.round((value / 60) * 10) / 10;
}

export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function offsetDate(offsetDays: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + offsetDays);
  return isoDate(d);
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatMonthDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatDdMmYyyy(iso: string): string {
  const [y, m, dd] = iso.split("-");
  return `${dd}/${m}/${y}`;
}

export function dayOfWeek(iso: string): number {
  return new Date(iso + "T00:00:00Z").getDay();
}

export function weekNumber(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
}

export function dayProgressFraction(): number {
  const now = new Date();
  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return Math.min(1, seconds / 86400);
}

export function deltaArrow(delta: number): string {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "->";
}
