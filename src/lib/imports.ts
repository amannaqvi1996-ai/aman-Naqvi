import Papa from "papaparse";
import { parseDuration } from "./format";

export type ParsedWorkout = {
  source: "fit_import" | "tcx_import" | "csv_import";
  external_id: string;
  type: string;
  title: string | null;
  started_at: string;
  duration_seconds: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories_kcal: number | null;
  elevation_gain_m: number | null;
  laps: { lap_number: number; distance_m: number | null; duration_seconds: number | null; avg_hr: number | null }[];
};

async function sha256(buf: ArrayBuffer | string): Promise<string> {
  const data = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf);
  const h = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function mapSport(s?: string | null): string {
  const v = (s ?? "").toLowerCase();
  if (/treadmill|indoor.?run/.test(v)) return "treadmill_run";
  if (/run|jog/.test(v)) return "run";
  if (/hyrox/.test(v)) return "hyrox";
  if (/strength|weight|training/.test(v)) return "strength";
  if (/row/.test(v)) return "row";
  if (/ski/.test(v)) return "ski_erg";
  if (/cycl|bik|ride/.test(v)) return "bike";
  if (/walk|hik/.test(v)) return "walk";
  if (/hiit|cardio|conditioning|crossfit/.test(v)) return "conditioning";
  if (/yoga|mobility|stretch|pilates/.test(v)) return "mobility";
  return "other";
}
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
const int = (v: unknown) => { const x = n(v); return x == null ? null : Math.round(x); };

export async function parseFit(file: File): Promise<ParsedWorkout[]> {
  const buf = await file.arrayBuffer();
  const { default: FitParser } = await import("fit-file-parser");
  const parser = new FitParser({ force: true, speedUnit: "m/s", lengthUnit: "m", mode: "list" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await parser.parseAsync(buf);
  const hash = await sha256(buf);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessions: any[] = data.sessions?.length ? data.sessions : [];
  if (!sessions.length) throw new Error(`${file.name}: no activity session found in this FIT file`);
  return sessions.map((s, i) => ({
    source: "fit_import", external_id: sessions.length > 1 ? `${hash}:${i}` : hash,
    type: mapSport(`${s.sport ?? ""} ${s.sub_sport ?? ""}`), title: s.sport ? String(s.sport).replace(/_/g, " ") : file.name,
    started_at: new Date(s.start_time ?? s.timestamp).toISOString(),
    duration_seconds: int(s.total_timer_time ?? s.total_elapsed_time), distance_m: n(s.total_distance),
    avg_hr: int(s.avg_heart_rate), max_hr: int(s.max_heart_rate), calories_kcal: int(s.total_calories), elevation_gain_m: n(s.total_ascent),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    laps: (data.laps ?? []).filter((l: any) => !s.start_time || new Date(l.start_time) >= new Date(s.start_time)).slice(0, 200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((l: any, k: number) => ({ lap_number: k + 1, distance_m: n(l.total_distance), duration_seconds: int(l.total_timer_time), avg_hr: int(l.avg_heart_rate) })),
  }));
}

export async function parseTcx(file: File): Promise<ParsedWorkout[]> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error(`${file.name}: not a valid TCX file`);
  const hash = await sha256(text);
  const acts = [...doc.getElementsByTagName("Activity")];
  if (!acts.length) throw new Error(`${file.name}: no activity found`);
  const txt = (el: Element, tag: string) => el.getElementsByTagName(tag)[0]?.textContent ?? null;
  return acts.map((a, i) => {
    const laps = [...a.getElementsByTagName("Lap")];
    const lapData = laps.map((l, k) => ({
      lap_number: k + 1, distance_m: n(txt(l, "DistanceMeters")), duration_seconds: int(txt(l, "TotalTimeSeconds")),
      avg_hr: int(l.getElementsByTagName("AverageHeartRateBpm")[0]?.getElementsByTagName("Value")[0]?.textContent),
    }));
    const maxHr = Math.max(0, ...laps.map((l) => Number(l.getElementsByTagName("MaximumHeartRateBpm")[0]?.getElementsByTagName("Value")[0]?.textContent ?? 0)));
    const dur = lapData.reduce((s, l) => s + (l.duration_seconds ?? 0), 0);
    const hrW = lapData.reduce((s, l) => s + (l.avg_hr ?? 0) * (l.duration_seconds ?? 0), 0);
    return {
      source: "tcx_import" as const, external_id: acts.length > 1 ? `${hash}:${i}` : hash,
      type: mapSport(a.getAttribute("Sport")), title: a.getAttribute("Sport"),
      started_at: new Date(txt(a, "Id") ?? laps[0]?.getAttribute("StartTime") ?? Date.now()).toISOString(),
      duration_seconds: dur || null, distance_m: lapData.reduce((s, l) => s + (l.distance_m ?? 0), 0) || null,
      avg_hr: dur && hrW ? Math.round(hrW / dur) : null, max_hr: maxHr || null,
      calories_kcal: laps.reduce((s, l) => s + Number(txt(l, "Calories") ?? 0), 0) || null, elevation_gain_m: null, laps: lapData,
    };
  });
}

/** Garmin Connect “Activities.csv” export, or any CSV with similar headers. */
export async function parseCsv(file: File): Promise<ParsedWorkout[]> {
  const text = await file.text();
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });
  const pick = (r: Record<string, string>, ...keys: string[]) => { for (const k of keys) if (r[k] != null && r[k] !== "" && r[k] !== "--") return r[k]; return null; };
  const out: ParsedWorkout[] = [];
  for (const r of res.data) {
    const date = pick(r, "date", "start time", "start_time", "started_at");
    if (!date) continue;
    const d = new Date(date.includes("T") || /[+Z]/.test(date) ? date : `${date.replace(" ", "T")}+05:30`);
    if (Number.isNaN(d.getTime())) continue;
    const distRaw = pick(r, "distance", "distance (km)", "distance_km", "distance_m");
    let dist = distRaw ? Number(distRaw.replace(/,/g, "")) : null;
    if (dist != null && !Number.isFinite(dist)) dist = null;
    // Garmin exports km (or miles); treat values < 500 as km
    const distance_m = dist == null ? null : dist < 500 ? dist * 1000 : dist;
    const time = pick(r, "time", "duration", "elapsed time", "moving time", "duration_seconds");
    const row = {
      source: "csv_import" as const, external_id: "",
      type: mapSport(pick(r, "activity type", "type", "sport")), title: pick(r, "title", "name"),
      started_at: d.toISOString(), duration_seconds: time ? parseDuration(time.split(".")[0]) : null, distance_m,
      avg_hr: int(pick(r, "avg hr", "average heart rate", "avg_hr")), max_hr: int(pick(r, "max hr", "max heart rate", "max_hr")),
      calories_kcal: int((pick(r, "calories", "calories_kcal") ?? "").replace(/,/g, "")), elevation_gain_m: n(pick(r, "total ascent", "elevation gain", "elev gain")), laps: [],
    };
    row.external_id = await sha256(`${row.started_at}|${row.type}|${row.distance_m ?? ""}|${row.duration_seconds ?? ""}`);
    out.push(row);
  }
  if (!out.length) throw new Error(`${file.name}: no rows with a recognisable date column`);
  return out;
}

export async function parseActivityFile(file: File): Promise<ParsedWorkout[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".fit")) return parseFit(file);
  if (name.endsWith(".tcx")) return parseTcx(file);
  if (name.endsWith(".csv")) return parseCsv(file);
  throw new Error(`${file.name}: unsupported file type (use .fit, .tcx or .csv)`);
}
