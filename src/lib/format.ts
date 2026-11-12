export const TZ = "Asia/Kolkata";

/** YYYY-MM-DD for a date in the user's timezone */
export function dayKey(d: Date = new Date(), tz = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** Monday of the ISO week containing `day` */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  return addDays(day, 1 - dow);
}

/** Start of a local day as an ISO timestamp (IST is a fixed +05:30 offset) */
export function dayStartISO(day: string): string {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}
export function dayEndISO(day: string): string {
  return new Date(`${addDays(day, 1)}T00:00:00+05:30`).toISOString();
}

export function fmtDay(day: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: TZ, ...opts });
}
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDuration(sec?: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
/** Parses "mm:ss", "h:mm:ss" or plain seconds */
export function parseDuration(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
export function fmtPace(secPerKm?: number | null): string {
  if (!secPerKm) return "—";
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}/km`;
}
export function num(v: unknown, digits = 0): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: 0 }) : "—";
}
/** Local datetime-input value (IST) for an ISO timestamp */
export function toLocalInput(iso: string = new Date().toISOString()): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60000);
  return d.toISOString().slice(0, 16);
}
export function fromLocalInput(v: string): string {
  return new Date(`${v}:00+05:30`).toISOString();
}
