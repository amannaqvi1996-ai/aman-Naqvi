import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { mapSport } from "@/lib/imports";

export const runtime = "nodejs";
export const maxDuration = 26;

// Garmin Connect Personal API (official, self-serve key for your own data).
// Key: Garmin Connect web → Settings → Personal API Key, stored in Netlify as GARMIN_PERSONAL_API_KEY.
const BASE = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

type Json = Record<string, unknown>;

let cachedToken: { key: string; token: string; exp: number } | null = null;

async function bearer(apiKey: string): Promise<string> {
  if (cachedToken && cachedToken.key === apiKey && cachedToken.exp - Date.now() / 1000 > 300) return cachedToken.token;
  const res = await fetch(`${BASE}${TOKEN_PATH}`, { method: "POST", headers: { Accept: "*/*", Authorization: `ApiKey ${apiKey}` } });
  const text = (await res.text()).trim();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new SyncError("Garmin rejected the Personal API key. It may have expired or been deleted — create a new one in Garmin Connect and update GARMIN_PERSONAL_API_KEY in Netlify.");
    throw new SyncError(`Garmin token request failed (${res.status}).`);
  }
  let exp = Date.now() / 1000 + 3600;
  try { exp = Number(JSON.parse(Buffer.from(text.split(".")[1], "base64url").toString()).exp) || exp; } catch { /* keep default */ }
  cachedToken = { key: apiKey, token: text, exp };
  return text;
}

class SyncError extends Error {}

async function gget(token: string, path: string, params?: Record<string, string | number>): Promise<unknown> {
  const qs = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
  const res = await fetch(`${BASE}${path}${qs}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new SyncError(`Garmin ${path.split("/")[1]} request failed (${res.status}).`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

/** Best-effort fetch: a failure of an optional metric must not abort the whole sync. */
async function soft<T>(p: Promise<T>, warnings: string[], what: string): Promise<T | null> {
  try { return await p; } catch (e) { warnings.push(`${what}: ${(e as Error).message}`); return null; }
}

const num = (v: unknown) => { const x = typeof v === "string" ? Number(v) : v; return typeof x === "number" && Number.isFinite(x) ? x : null; };
const pos = (v: unknown) => { const x = num(v); return x != null && x > 0 ? x : null; };
const int = (v: unknown) => { const x = pos(v); return x == null ? null : Math.round(x); };

/** Depth-limited search for the first numeric value under any of the given keys. */
function pick(obj: unknown, keys: string[], depth = 4): number | null {
  if (!obj || typeof obj !== "object" || depth < 0) return null;
  const o = obj as Json;
  for (const k of keys) if (k in o) { const v = num(o[k]); if (v != null) return v; if (o[k] && typeof o[k] === "object" && "value" in (o[k] as Json)) { const w = num((o[k] as Json).value); if (w != null) return w; } }
  for (const v of Object.values(o)) if (v && typeof v === "object") { const r = pick(v, keys, depth - 1); if (r != null) return r; }
  return null;
}

/** Turns any of Garmin's range responses into a flat list of per-day records. */
function records(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload.filter((r) => r && typeof r === "object") as Json[];
  if (payload && typeof payload === "object") {
    for (const v of Object.values(payload as Json)) if (Array.isArray(v) && v.some((r) => r && typeof r === "object")) return v as Json[];
  }
  return [];
}

function dateOf(r: Json): string | null {
  for (const k of ["calendarDate", "summaryDate", "date", "day"]) {
    const v = r[k] ?? (r.dailySleepDTO as Json | undefined)?.[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

function istDay(d: Date) { return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10); }

async function logAttempt(sb: SupabaseClient, row: Json): Promise<string | null> {
  try { const { error } = await sb.from("garmin_sync_logs").insert(row); return error ? error.message : null; } catch (e) { return (e as Error).message; }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GARMIN_PERSONAL_API_KEY?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return NextResponse.json({ error: "Authentication service is not configured." }, { status: 503 });
  if (!apiKey) return NextResponse.json({ error: "Garmin is not connected yet. Add GARMIN_PERSONAL_API_KEY to Netlify environment variables, then redeploy.", code: "not_configured" }, { status: 503 });

  const authorization = request.headers.get("authorization") ?? "";
  const userToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!userToken) return NextResponse.json({ error: "Please sign in to sync Garmin." }, { status: 401 });
  const sb = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${userToken}` } } });
  const { data: authData, error: authError } = await sb.auth.getUser(userToken);
  if (authError || !authData.user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  const userId = authData.user.id;

  const body = await request.json().catch(() => ({}));
  const days = Math.min(Math.max(Number(body?.days) || 14, 1), 90);
  const end = istDay(new Date());
  const start = istDay(new Date(Date.now() - (days - 1) * 86400_000));
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];

  try {
    const token = await bearer(apiKey);

    // --- Activities → workouts ---------------------------------------------
    const acts: Json[] = [];
    for (let page = 0; page < 5; page++) {
      const batch = records(await gget(token, "/activitylist-service/activities/search/activities", { start: page * 100, limit: 100, startDate: start, endDate: end }));
      acts.push(...batch);
      if (batch.length < 100) break;
    }
    const rows = acts.map((a) => {
      const t = a.activityType as Json | undefined;
      const typeKey = String(t?.typeKey ?? a.activityType ?? "");
      const startGmt = typeof a.startTimeGMT === "string" ? `${a.startTimeGMT.replace(" ", "T")}Z` : null;
      const startLocal = typeof a.startTimeLocal === "string" ? `${a.startTimeLocal.replace(" ", "T")}+05:30` : null;
      const startIso = startGmt ?? startLocal;
      const name = typeof a.activityName === "string" ? a.activityName : null;
      return {
        source: "garmin",
        external_id: `garmin:${a.activityId}`,
        type: mapSport(`${typeKey} ${name ?? ""}`.replace(/_/g, " ")),
        title: name,
        started_at: startIso ? new Date(startIso).toISOString() : null,
        duration_seconds: int(a.movingDuration ?? a.duration ?? a.elapsedDuration),
        distance_m: pos(a.distance),
        avg_hr: int(a.averageHR ?? a.averageHeartRate),
        max_hr: int(a.maxHR ?? a.maxHeartRate),
        calories_kcal: int(a.calories),
        elevation_gain_m: pos(a.elevationGain),
      };
    }).filter((r) => r.started_at && r.external_id !== "garmin:undefined");

    let imported = 0;
    if (rows.length) {
      const { data: existing, error } = await sb.from("workouts").select("external_id").in("external_id", rows.map((r) => r.external_id));
      if (error) throw error;
      const have = new Set((existing ?? []).map((r: { external_id: string }) => r.external_id));
      const fresh = rows.filter((r) => !have.has(r.external_id));
      for (const r of fresh) {
        const ins = await sb.from("workouts").insert(r);
        if (ins.error) {
          if (/duplicate/i.test(ins.error.message)) continue;
          if (ins.error.code === "23514") throw new SyncError("The database doesn't allow 'garmin' as a workout source yet (check constraint). Allow it on workouts.source and daily_activity.source.");
          throw ins.error;
        }
        imported++;
      }
    }

    // --- Daily metrics → daily_activity --------------------------------------
    // Garmin rejects long ranges on some endpoints (sleep returns 400 for ~90 days), so fetch in 7-day windows.
    const windows: [string, string][] = [];
    for (let s0 = start; s0 <= end;) {
      const e0 = istDay(new Date(Math.min(new Date(`${s0}T12:00:00Z`).getTime() + 6 * 86400_000, new Date(`${end}T12:00:00Z`).getTime())));
      windows.push([s0, e0]);
      s0 = istDay(new Date(new Date(`${e0}T12:00:00Z`).getTime() + 86400_000));
    }
    const chunked = async (what: string, f: (a: string, b: string) => Promise<unknown>) => {
      const parts = await Promise.all(windows.map(([a, b]) => soft(f(a, b), warnings, what)));
      return parts.flatMap((p) => records(p));
    };
    const [summaries, sleep, hrv] = await Promise.all([
      chunked("daily summaries", (a, b) => gget(token, "/usersummary-service/v2/dailysummaries", { startDate: a, endDate: b })),
      chunked("sleep", (a, b) => gget(token, "/sleep-service/sleep/dailySleepSummariesByDate", { startDate: a, endDate: b })),
      chunked("HRV", (a, b) => gget(token, `/hrv-service/hrv/daily/${a}/${b}`)),
    ]);
    // Keep one copy of each distinct warning.
    const uniq = [...new Set(warnings)]; warnings.length = 0; warnings.push(...uniq);
    const byDay = new Map<string, Json>();
    const put = (d: string, k: string, v: number | null) => { if (v == null) return; const row = byDay.get(d) ?? { day: d, source: "garmin" }; row[k] = v; byDay.set(d, row); };
    for (const r of summaries) {
      const d = dateOf(r); if (!d) continue;
      put(d, "steps", int(pick(r, ["totalSteps", "steps"])));
      put(d, "active_kcal", int(pick(r, ["activeKilocalories", "activeCalories"])));
      put(d, "resting_hr", int(pick(r, ["restingHeartRate", "restingHeartRateValue"])));
      put(d, "body_battery", int(pick(r, ["bodyBatteryMostRecentValue", "bodyBatteryAtWakeTime", "bodyBatteryHighestValue"])));
      put(d, "training_readiness", int(pick(r, ["trainingReadinessScore", "trainingReadiness"])));
    }
    for (const r of sleep) {
      const d = dateOf(r); if (!d) continue;
      const secs = pick(r, ["sleepTimeSeconds", "totalSleepSeconds", "sleepDurationInSeconds"]);
      put(d, "sleep_minutes", secs != null && secs > 0 ? Math.round(secs / 60) : null);
      put(d, "sleep_score", int(pick(r, ["overallSleepScore", "sleepScore", "overall"])));
    }
    for (const r of hrv) {
      const d = dateOf(r); if (!d) continue;
      put(d, "hrv_ms", int(pick(r, ["lastNightAvg", "weeklyAvg"])));
    }
    let daysSaved = 0;
    if (byDay.size) {
      const dayRows = [...byDay.values()];
      const { error } = await sb.from("daily_activity").upsert(dayRows, { onConflict: "user_id,day,source" });
      if (error) {
        if (error.code === "23514") throw new SyncError("The database doesn't allow 'garmin' as a daily metrics source yet (check constraint).");
        warnings.push(`daily metrics: ${error.message}`);
      } else daysSaved = dayRows.length;
    }

    const now = new Date().toISOString();
    const latest = rows.map((r) => r.started_at as string).sort().pop() ?? null;
    const statusErrors: string[] = [];
    try {
      const conn: Json = { status: "authorised", last_successful_sync: now, last_error: warnings.length ? warnings.join(" · ").slice(0, 500) : null, ...(latest ? { last_imported_activity_at: latest } : {}) };
      const cur = await sb.from("garmin_connections").select("*").maybeSingle();
      if (cur.error) statusErrors.push(`read: ${cur.error.message}`);
      const w = cur.data
        ? await sb.from("garmin_connections").update({ ...conn, authorised_at: (cur.data as Json).authorised_at ?? now }).eq("user_id", userId)
        : await sb.from("garmin_connections").insert({ ...conn, user_id: userId, authorised_at: now });
      if (w.error) statusErrors.push(`write: ${w.error.message}`);
    } catch (e) { statusErrors.push((e as Error).message); }
    const logErr = await logAttempt(sb, { user_id: userId, started_at: startedAt, outcome: "success", activities_imported: imported, error: warnings.length ? warnings.join(" · ").slice(0, 500) : null });
    if (logErr) statusErrors.push(`log: ${logErr}`);
    if (statusErrors.length) console.error("Garmin status/log write failed:", statusErrors.join(" | "));

    return NextResponse.json({ ok: true, synced_at: now, range: { start, end }, activities_found: rows.length, activities_imported: imported, days_saved: daysSaved, warnings, status_errors: statusErrors });
  } catch (e) {
    const message = e instanceof SyncError ? e.message : (e as { message?: string })?.message ?? "Garmin sync failed.";
    console.error("Garmin sync failed:", message);
    try { await sb.from("garmin_connections").update({ status: "error", last_error: message.slice(0, 500) }).eq("user_id", userId); } catch { /* optional */ }
    await logAttempt(sb, { user_id: userId, started_at: startedAt, outcome: "failed", activities_imported: 0, error: message.slice(0, 500) });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
