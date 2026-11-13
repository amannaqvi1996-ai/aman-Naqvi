"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Upload, Trash2, Watch, Link2Off, ShieldCheck, Clock, AlertTriangle, Trophy, RefreshCw } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { dayKey, addDays, fmtDay, fmtDuration, parseDuration, num, fmtPace, weekStart, toLocalInput, fromLocalInput, fmtDateTime } from "@/lib/format";
import { parseActivityFile, type ParsedWorkout } from "@/lib/imports";
import { Card, PageHeader, Spinner, ErrorBox, Button, Empty, Badge, Stat, Segmented, Select, Input, Field, Sheet, Textarea, useToast, ListRow, Confirm, cx } from "@/components/ui";
import { BarChartBox, LineChartBox } from "@/components/charts";

type Workout = { id: string; source: string; type: string; title: string | null; started_at: string; duration_seconds: number | null; distance_m: number | null; avg_pace_s_per_km: number | null; avg_hr: number | null; max_hr: number | null; calories_kcal: number | null; rpe: number | null; notes: string | null };
type Day = { id: string; day: string; source: string; steps: number | null; active_kcal: number | null; resting_hr: number | null; sleep_minutes: number | null; sleep_score: number | null; hrv_ms: number | null; body_battery: number | null; training_readiness: number | null };
type Conn = { status: string; authorised_at: string | null; last_successful_sync: string | null; last_imported_activity_at: string | null; last_error: string | null };
type Log = { id: string; started_at: string; outcome: string; error: string | null; activities_imported: number };

const TYPES = ["run", "treadmill_run", "strength", "hyrox", "conditioning", "row", "ski_erg", "bike", "walk", "mobility", "recovery", "other"];
const label = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function FitnessPage() {
  const [tab, setTab] = useState<"activity" | "workouts" | "import" | "garmin">("activity");
  const [wSheet, setWSheet] = useState<{ open: boolean; w?: Partial<Workout> }>({ open: false });
  const { data, error, loading, reload } = useLive(async () => {
    const since = addDays(dayKey(), -400);
    const [workouts, days, conn, logs] = await Promise.all([
      must(supabase.from("workouts").select("id, source, type, title, started_at, duration_seconds, distance_m, avg_pace_s_per_km, avg_hr, max_hr, calories_kcal, rpe, notes").gte("started_at", new Date(`${since}T00:00:00+05:30`).toISOString()).order("started_at", { ascending: false })),
      must(supabase.from("daily_activity").select("*").order("day", { ascending: false }).limit(60)),
      must(supabase.from("garmin_connections").select("*").maybeSingle()),
      must(supabase.from("garmin_sync_logs").select("*").order("started_at", { ascending: false }).limit(10)),
    ]);
    return { workouts: workouts as Workout[], days: days as Day[], conn: conn as Conn | null, logs: logs as Log[] };
  }, ["workouts", "daily_activity", "garmin_connections", "garmin_sync_logs"]);
  const autoTried = useRef(false);
  useEffect(() => {
    if (!data || autoTried.current) return;
    autoTried.current = true;
    let local: string | null = null; try { local = localStorage.getItem("garmin_last_sync"); } catch { /* ignore */ }
    const lastIso = data.conn?.last_successful_sync ?? local;
    const last = lastIso ? new Date(lastIso).getTime() : 0;
    const connected = data.conn?.status === "authorised" || !!local || data.workouts.some((w) => w.source === "garmin");
    if (connected && Date.now() - last > 2 * 3600_000) syncGarmin(14).then(reload).catch(() => {});
  }, [data, reload]);

  return (
    <>
      <PageHeader title="Fitness & Garmin" subtitle="Activity, running and imports" action={<Button onClick={() => setWSheet({ open: true, w: { type: "run", started_at: new Date().toISOString() } })}><Plus className="size-4" />Workout</Button>} />
      <div className="mb-4"><Segmented value={tab} onChange={setTab} options={[{ value: "activity", label: "Overview" }, { value: "workouts", label: "Workouts" }, { value: "import", label: "Import files" }, { value: "garmin", label: "Garmin" }]} /></div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          {tab === "activity" && <Overview workouts={data.workouts} days={data.days} reload={reload} />}
          {tab === "workouts" && <Workouts workouts={data.workouts} onOpen={(w) => setWSheet({ open: true, w })} />}
          {tab === "import" && <Import onDone={reload} />}
          {tab === "garmin" && <Garmin conn={data.conn} logs={data.logs} workouts={data.workouts} reload={reload} />}
        </>
      )}
      <WorkoutSheet open={wSheet.open} w={wSheet.w} onClose={() => setWSheet({ open: false })} onSaved={reload} />
    </>
  );
}

async function syncGarmin(days: number): Promise<{ activities_imported: number; activities_found: number; days_saved: number; warnings: string[]; synced_at?: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const res = await fetch("/api/garmin/sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ days }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || "Garmin sync failed.");
  try { localStorage.setItem("garmin_last_sync", out.synced_at ?? new Date().toISOString()); } catch { /* storage optional */ }
  return out;
}

function isRun(w: Workout) { return w.type === "run" || w.type === "treadmill_run"; }

function Overview({ workouts, days, reload }: { workouts: Workout[]; days: Day[]; reload: () => void }) {
  const [dSheet, setDSheet] = useState(false);
  const today = dayKey();
  const todayRow = days.find((d) => d.day === today);
  const wk = weekStart(today);
  const runs = workouts.filter(isRun);
  const weekKm = runs.filter((r) => dayKey(new Date(r.started_at)) >= wk).reduce((a, r) => a + Number(r.distance_m ?? 0) / 1000, 0);
  const monthKey = today.slice(0, 7);
  const monthKm = runs.filter((r) => dayKey(new Date(r.started_at)).startsWith(monthKey)).reduce((a, r) => a + Number(r.distance_m ?? 0) / 1000, 0);
  const weekly = Array.from({ length: 12 }, (_, i) => { const s = addDays(wk, -7 * (11 - i)); return { week: fmtDay(s), km: Math.round(runs.filter((r) => { const k = dayKey(new Date(r.started_at)); return k >= s && k < addDays(s, 7); }).reduce((a, r) => a + Number(r.distance_m ?? 0) / 1000, 0) * 10) / 10 }; });
  const monthly = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - (5 - i)); const k = dayKey(d).slice(0, 7); return { month: new Date(`${k}-15`).toLocaleDateString("en-IN", { month: "short" }), km: Math.round(runs.filter((r) => dayKey(new Date(r.started_at)).startsWith(k)).reduce((a, r) => a + Number(r.distance_m ?? 0) / 1000, 0) * 10) / 10 }; });
  const pace = runs.filter((r) => r.avg_pace_s_per_km && Number(r.distance_m) >= 2000).slice(0, 30).reverse().map((r) => ({ day: fmtDay(dayKey(new Date(r.started_at))), pace: Math.round(Number(r.avg_pace_s_per_km)) }));
  const best = (min: number, max: number) => runs.filter((r) => Number(r.distance_m) >= min && Number(r.distance_m) <= max && r.duration_seconds).sort((a, b) => Number(a.avg_pace_s_per_km) - Number(b.avg_pace_s_per_km))[0];
  const pbs = [{ l: "1 km", w: best(950, 1100) }, { l: "5 km", w: best(4900, 5300) }, { l: "10 km", w: best(9800, 10500) }, { l: "Half", w: best(20900, 21500) }, { l: "Longest run", w: runs.slice().sort((a, b) => Number(b.distance_m) - Number(a.distance_m))[0] }];
  const strength = workouts.filter((w) => w.type === "strength" || w.type === "hyrox" || w.type === "conditioning");
  const cal = Array.from({ length: 28 }, (_, i) => addDays(wk, i - 21));
  const sleep = days.filter((d) => d.sleep_minutes).slice(0, 14).reverse().map((d) => ({ day: fmtDay(d.day), hours: Math.round(Number(d.sleep_minutes) / 6) / 10 }));

  return (
    <div className="grid gap-3 lg:gap-4 lg:grid-cols-3">
      <Card title="Today" action={<button className="text-xs text-accent" onClick={() => setDSheet(true)}>Log daily metrics</button>}>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Steps" value={todayRow?.steps != null ? num(todayRow.steps) : "—"} />
          <Stat label="Sleep" value={todayRow?.sleep_minutes ? fmtDuration(todayRow.sleep_minutes * 60).replace(/:\d\d$/, "") : "—"} unit={todayRow?.sleep_minutes ? "h" : undefined} />
          <Stat label="Resting HR" value={todayRow?.resting_hr ?? "—"} unit={todayRow?.resting_hr ? "bpm" : undefined} />
          <Stat label="Readiness" value={todayRow?.training_readiness ?? todayRow?.body_battery ?? "—"} sub={todayRow?.training_readiness != null ? "training readiness" : todayRow?.body_battery != null ? "body battery" : "not recorded"} />
        </div>
        {!todayRow && <p className="text-xs text-ink-3 mt-3">No daily metrics for today. Sync Garmin from the Garmin tab, or log them manually.</p>}
      </Card>
      <Card title="Running">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="This week" value={num(weekKm, 1)} unit="km" />
          <Stat label="This month" value={num(monthKm, 1)} unit="km" />
          <Stat label="Runs (30d)" value={runs.filter((r) => dayKey(new Date(r.started_at)) >= addDays(today, -30)).length} />
          <Stat label="Strength (30d)" value={strength.filter((r) => dayKey(new Date(r.started_at)) >= addDays(today, -30)).length} />
        </div>
      </Card>
      <Card title="Personal bests" pad={false}>
        {pbs.map((p) => (
          <ListRow key={p.l} right={<span className="tabular text-sm">{p.w ? (p.l === "Longest run" ? `${num(Number(p.w.distance_m) / 1000, 1)} km` : fmtDuration(p.w.duration_seconds)) : "—"}</span>}>
            <div className="flex items-center gap-2"><Trophy className="size-4 text-warn" /><span className="font-medium">{p.l}</span></div>
            {p.w && <div className="text-xs text-ink-3 pl-6">{fmtDay(dayKey(new Date(p.w.started_at)), { day: "numeric", month: "short", year: "numeric" })} · {fmtPace(p.w.avg_pace_s_per_km)}</div>}
          </ListRow>
        ))}
      </Card>
      <Card title="Weekly mileage (km)" className="lg:col-span-2"><BarChartBox data={weekly} x="week" bars={[{ key: "km", name: "km" }]} height={200} /></Card>
      <Card title="Monthly mileage (km)"><BarChartBox data={monthly} x="month" bars={[{ key: "km", name: "km", color: "#7ab8f5" }]} height={200} /></Card>
      <Card title="Pace trend (sec/km, runs ≥ 2 km)" className="lg:col-span-2">{pace.length ? <LineChartBox data={pace} x="day" lines={[{ key: "pace", name: "sec/km" }]} height={200} /> : <Empty title="No runs yet" />}</Card>
      <Card title="Sleep (hours)">{sleep.length ? <BarChartBox data={sleep} x="day" bars={[{ key: "hours", name: "hours", color: "#7ab8f5" }]} height={200} refY={7} refLabel="7h" /> : <Empty title="No sleep data" />}</Card>
      <Card title="Workout calendar · 4 weeks" className="lg:col-span-3">
        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-ink-3 mb-1">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i}>{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1.5">
          {cal.map((d) => {
            const ws = workouts.filter((w) => dayKey(new Date(w.started_at)) === d);
            const km = ws.filter(isRun).reduce((a, w) => a + Number(w.distance_m ?? 0) / 1000, 0);
            return (
              <div key={d} className={cx("aspect-square rounded-xl p-1.5 text-left flex flex-col justify-between", d === today ? "ring-1 ring-accent" : "", ws.length ? "bg-accent/15" : "bg-surface-2", d > today && "opacity-40")}>
                <span className="text-[11px] text-ink-3">{Number(d.slice(8))}</span>
                {ws.length > 0 && <span className="text-[10px] font-semibold text-accent truncate">{km ? `${num(km, 1)}k` : ws.length > 1 ? `${ws.length}×` : label(ws[0].type).slice(0, 5)}</span>}
              </div>
            );
          })}
        </div>
      </Card>
      <DailySheet open={dSheet} onClose={() => setDSheet(false)} existing={todayRow} onSaved={reload} />
    </div>
  );
}

function DailySheet({ open, onClose, existing, onSaved }: { open: boolean; onClose: () => void; existing?: Day; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [day, setDay] = useState(dayKey());
  const fields: [keyof Day, string][] = [["steps", "Steps"], ["active_kcal", "Active kcal"], ["resting_hr", "Resting HR"], ["sleep_minutes", "Sleep (min)"], ["sleep_score", "Sleep score"], ["hrv_ms", "HRV (ms)"], ["body_battery", "Body battery"], ["training_readiness", "Training readiness"]];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const row: Record<string, unknown> = { day, source: "manual" };
    fields.forEach(([k]) => { row[k] = f[k] !== undefined && f[k] !== "" ? Number(f[k]) : existing && day === existing.day && existing.source === "manual" ? existing[k] : null; });
    const { error } = await supabase.from("daily_activity").upsert(row, { onConflict: "user_id,day,source" });
    if (error) toast(errMsg(error), "err"); else { toast("Saved"); setF({}); onSaved(); onClose(); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Daily metrics">
      <form onSubmit={save} className="space-y-4">
        <Field label="Date"><Input type="date" max={dayKey()} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          {fields.map(([k, l]) => <Field key={k} label={l}><Input inputMode="numeric" placeholder={existing && day === existing.day && existing[k] != null ? String(existing[k]) : ""} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
        </div>
        <p className="text-xs text-ink-3">Leave a field blank to keep what&apos;s already recorded. Only enter values you actually have — nothing is estimated.</p>
        <Button size="lg" type="submit">Save</Button>
      </form>
    </Sheet>
  );
}

function Workouts({ workouts, onOpen }: { workouts: Workout[]; onOpen: (w: Workout) => void }) {
  const [type, setType] = useState("");
  const list = workouts.filter((w) => !type || w.type === type);
  return (
    <>
      <div className="mb-3 max-w-xs"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></div>
      <Card pad={false}>
        {list.length ? list.map((w) => (
          <ListRow key={w.id} onClick={() => onOpen(w)} right={<span className="text-sm tabular text-ink-2 text-right">{w.distance_m ? `${num(Number(w.distance_m) / 1000, 2)} km` : ""}<br /><span className="text-ink-3 text-xs">{fmtDuration(w.duration_seconds)}</span></span>}>
            <div className="flex items-center gap-2"><span className="font-medium truncate">{w.title || label(w.type)}</span>{w.source !== "manual" && <Badge>{w.source.replace("_import", "").toUpperCase()}</Badge>}</div>
            <div className="text-xs text-ink-3">{fmtDateTime(w.started_at)} · {label(w.type)}{w.avg_pace_s_per_km && isRun(w) ? ` · ${fmtPace(w.avg_pace_s_per_km)}` : ""}{w.avg_hr ? ` · ${w.avg_hr} bpm` : ""}</div>
          </ListRow>
        )) : <Empty title="No workouts yet" body="Add one manually or import FIT/TCX/CSV files." />}
      </Card>
    </>
  );
}

function WorkoutSheet({ open, w, onClose, onSaved }: { open: boolean; w?: Partial<Workout>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [del, setDel] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const k = open ? (w?.id ?? "new") : null;
  if (k !== lastKey) {
    setLastKey(k);
    if (open) setF({ type: w?.type ?? "run", title: w?.title ?? "", started_at: toLocalInput(w?.started_at ?? new Date().toISOString()), duration: w?.duration_seconds ? fmtDuration(w.duration_seconds) : "", km: w?.distance_m ? String(Number(w.distance_m) / 1000) : "", avg_hr: w?.avg_hr?.toString() ?? "", max_hr: w?.max_hr?.toString() ?? "", calories: w?.calories_kcal?.toString() ?? "", rpe: w?.rpe?.toString() ?? "", notes: w?.notes ?? "" });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const row = { type: f.type, title: f.title || null, started_at: fromLocalInput(f.started_at), duration_seconds: parseDuration(f.duration ?? ""), distance_m: f.km ? Math.round(Number(f.km) * 1000 * 10) / 10 : null, avg_hr: f.avg_hr ? Number(f.avg_hr) : null, max_hr: f.max_hr ? Number(f.max_hr) : null, calories_kcal: f.calories ? Number(f.calories) : null, rpe: f.rpe ? Number(f.rpe) : null, notes: f.notes || null };
    const { error } = w?.id ? await supabase.from("workouts").update(row).eq("id", w.id) : await supabase.from("workouts").insert({ ...row, source: "manual" });
    if (error) toast(errMsg(error), "err"); else { toast("Saved"); onSaved(); onClose(); }
  }
  return (
    <Sheet open={open} onClose={onClose} title={w?.id ? "Edit workout" : "Add workout"}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
          <Field label="Start"><Input type="datetime-local" value={f.started_at ?? ""} onChange={(e) => setF({ ...f, started_at: e.target.value })} /></Field>
          <Field label="Title" className="col-span-2"><Input value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Duration" hint="h:mm:ss or mm:ss"><Input value={f.duration ?? ""} onChange={(e) => setF({ ...f, duration: e.target.value })} placeholder="45:00" /></Field>
          <Field label="Distance (km)"><Input inputMode="decimal" value={f.km ?? ""} onChange={(e) => setF({ ...f, km: e.target.value })} /></Field>
          <Field label="Avg HR"><Input inputMode="numeric" value={f.avg_hr ?? ""} onChange={(e) => setF({ ...f, avg_hr: e.target.value })} /></Field>
          <Field label="Max HR"><Input inputMode="numeric" value={f.max_hr ?? ""} onChange={(e) => setF({ ...f, max_hr: e.target.value })} /></Field>
          <Field label="Calories"><Input inputMode="numeric" value={f.calories ?? ""} onChange={(e) => setF({ ...f, calories: e.target.value })} /></Field>
          <Field label="RPE (1–10)"><Select value={f.rpe ?? ""} onChange={(e) => setF({ ...f, rpe: e.target.value })}><option value="">—</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select></Field>
        </div>
        <Field label="Notes"><Textarea value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-16" /></Field>
        <div className="flex gap-2">{w?.id && <Button type="button" variant="danger" onClick={() => setDel(true)}><Trash2 className="size-4" /></Button>}<Button size="lg" type="submit" className="flex-1">Save</Button></div>
      </form>
      <Confirm open={del} title="Delete workout?" onClose={() => setDel(false)} onConfirm={async () => { const { error } = await supabase.from("workouts").delete().eq("id", w!.id!); if (error) toast(errMsg(error), "err"); else { onSaved(); onClose(); } }} />
    </Sheet>
  );
}

function Import({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<ParsedWorkout[]>([]);
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onFiles(files: FileList) {
    setBusy(true); setResult(null);
    const all: ParsedWorkout[] = []; const e: string[] = [];
    for (const f of Array.from(files)) {
      if (f.size > 50 * 1024 * 1024) { e.push(`${f.name}: larger than 50 MB`); continue; }
      try { all.push(...(await parseActivityFile(f))); } catch (err) { e.push(errMsg(err)); }
    }
    setItems(all); setErrs(e); setBusy(false);
  }
  async function run() {
    setBusy(true);
    try {
      const ids = items.map((i) => i.external_id);
      const existing = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from("workouts").select("external_id").in("external_id", ids.slice(i, i + 200));
        (data ?? []).forEach((r: { external_id: string }) => existing.add(r.external_id));
      }
      const fresh = items.filter((i) => !existing.has(i.external_id));
      let n = 0;
      for (const w of fresh) {
        const { laps, ...row } = w;
        const ins = await supabase.from("workouts").insert(row).select("id").single();
        if (ins.error) { if (!/duplicate/i.test(ins.error.message)) throw ins.error; continue; }
        n++;
        if (laps.length) await supabase.from("workout_laps").insert(laps.map((l) => ({ ...l, workout_id: (ins.data as { id: string }).id })));
      }
      setResult(`Imported ${n} activities${items.length - n ? ` · ${items.length - n} already imported` : ""}`);
      setItems([]); onDone();
    } catch (err) { toast(errMsg(err), "err"); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card title="Import activity files" className="lg:col-span-2">
        <p className="text-sm text-ink-2 mb-4">Upload <b>.fit</b> or <b>.tcx</b> files exported from Garmin Connect, or the <b>Activities.csv</b> list export. Files are read on this device; only the activity summary is saved. Re-importing the same file is detected and skipped.</p>
        <label className="flex flex-col items-center justify-center gap-2 h-36 rounded-2xl border-2 border-dashed border-line hover:border-accent/50 cursor-pointer text-ink-2">
          <Upload className="size-6" /><span className="text-sm font-medium">{busy ? "Reading…" : "Choose files"}</span>
          <input type="file" multiple accept=".fit,.tcx,.csv" className="hidden" onChange={(e) => e.target.files && onFiles(e.target.files)} />
        </label>
        {errs.length > 0 && <ul className="mt-3 text-xs text-warn space-y-1">{errs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        {result && <div className="mt-3 rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm text-accent">{result}</div>}
        {items.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-line-soft max-h-72 overflow-auto">
              {items.map((w, i) => (
                <div key={i} className="px-3 py-2 border-t border-line-soft first:border-t-0 text-sm flex justify-between gap-2">
                  <span><span className="font-medium">{label(w.type)}</span> <span className="text-ink-3">· {fmtDateTime(w.started_at)}</span></span>
                  <span className="tabular text-ink-2">{w.distance_m ? `${num(w.distance_m / 1000, 2)} km · ` : ""}{fmtDuration(w.duration_seconds)}</span>
                </div>
              ))}
            </div>
            <Button size="lg" onClick={run} loading={busy}>Import {items.length} {items.length === 1 ? "activity" : "activities"}</Button>
          </div>
        )}
      </Card>
      <Card title="How to export from Garmin">
        <ol className="text-sm text-ink-2 space-y-2 list-decimal pl-4">
          <li>Open <b>connect.garmin.com</b> on your Mac.</li>
          <li>Open an activity → ⚙︎ menu → <b>Export Original</b> (FIT, zipped — unzip first) or <b>Export to TCX</b>.</li>
          <li>For many runs: Activities → All activities → <b>Export CSV</b>.</li>
        </ol>
      </Card>
    </div>
  );
}

function Garmin({ conn, logs, workouts, reload }: { conn: Conn | null; logs: Log[]; workouts: Workout[]; reload: () => void }) {
  const toast = useToast();
  const [disc, setDisc] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  async function sync(days: number) {
    setBusy(days);
    try {
      const r = await syncGarmin(days);
      toast(`Synced · ${r.activities_imported} new ${r.activities_imported === 1 ? "activity" : "activities"} · ${r.days_saved} days of metrics`);
      if (r.warnings?.length) toast(`Some metrics skipped: ${r.warnings[0]}`, "err");
      reload();
    } catch (e) { toast(errMsg(e), "err"); reload(); } finally { setBusy(null); }
  }
  let localSync: string | null = null; try { localSync = typeof window !== "undefined" ? localStorage.getItem("garmin_last_sync") : null; } catch { /* ignore */ }
  const hasGarminData = workouts.some((w) => w.source === "garmin");
  const status = conn?.status ?? (localSync || hasGarminData ? "authorised" : "pending_connection");
  const lastSync = conn?.last_successful_sync ?? localSync;
  const latestImport = workouts.find((w) => w.source !== "manual");
  const failures = logs.filter((l) => l.outcome === "failed");
  const rows: [string, React.ReactNode, React.ElementType][] = [
    ["Connection status", status === "authorised" ? <Badge tone="accent">Connected</Badge> : status === "error" ? <Badge tone="danger">Error</Badge> : status === "disconnected" ? <Badge>Disconnected</Badge> : <Badge tone="warn">Pending Connection</Badge>, Watch],
    ["Authorisation", conn?.authorised_at ? `Authorised ${fmtDateTime(conn.authorised_at)}` : status === "authorised" ? "Personal API key (Netlify)" : "Not authorised", ShieldCheck],
    ["Last successful sync", lastSync ? fmtDateTime(lastSync) : "Never", Clock],
    ["Latest imported activity", latestImport ? `${label(latestImport.type)} · ${fmtDateTime(latestImport.started_at)} (${latestImport.source.replace("_import", "").toUpperCase()})` : "None yet", Upload],
    ["Sync failures", failures.length ? `${failures.length} recent` : "None", AlertTriangle],
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card title="Garmin Connect" pad={false} className="lg:col-span-2">
        {rows.map(([l, v, Icon]) => (
          <ListRow key={l} right={<span className="text-sm text-right text-ink-2">{v}</span>}><div className="flex items-center gap-3"><Icon className="size-4 text-ink-3" /><span>{l}</span></div></ListRow>
        ))}
        <div className="p-4 border-t border-line-soft flex flex-wrap gap-2">
          <Button disabled={busy != null} onClick={() => sync(14)}><RefreshCw className={cx("size-4", busy === 14 && "animate-spin")} />{busy === 14 ? "Syncing…" : "Sync now"}</Button>
          <Button variant="secondary" disabled={busy != null} onClick={() => sync(90)}>{busy === 90 ? "Syncing…" : "Sync last 90 days"}</Button>
          <Button variant="danger" disabled={!conn} onClick={() => setDisc(true)}><Link2Off className="size-4" />Disconnect</Button>
        </div>
      </Card>
      <Card title="How Garmin sync works">
        <div className="text-sm text-ink-2 space-y-2">
          <p>AMAN OS reads your own data through Garmin&apos;s official <b>Connect Personal API</b> — activities, steps, sleep, resting HR, HRV and body battery. Read-only; nothing is sent to your watch.</p>
          <p>The app syncs automatically when you open Fitness (if the last sync is over 2 hours old). Tap <b>Sync now</b> any time; use <b>Sync last 90 days</b> once to backfill.</p>
          <p>Your key lives only in Netlify (<span className="font-mono text-xs">GARMIN_PERSONAL_API_KEY</span>). When it expires, create a new one at Garmin Connect → Settings → Personal API Key and replace it there.</p>
        </div>
      </Card>
      {logs.length > 0 && (
        <Card title="Sync log" pad={false} className="lg:col-span-3">
          {logs.map((l) => <ListRow key={l.id} right={<Badge tone={l.outcome === "success" ? "accent" : l.outcome === "failed" ? "danger" : "warn"}>{l.outcome}</Badge>}><div className="text-sm">{fmtDateTime(l.started_at)} · {l.activities_imported} activities</div>{l.error && <div className="text-xs text-danger">{l.error}</div>}</ListRow>)}
        </Card>
      )}
      <Confirm open={disc} title="Disconnect Garmin?" body="Imported activities are kept." confirmLabel="Disconnect" onClose={() => setDisc(false)}
        onConfirm={async () => { const { error } = await supabase.from("garmin_connections").delete().not("id", "is", null); if (error) toast(errMsg(error), "err"); else reload(); }} />
    </div>
  );
}
