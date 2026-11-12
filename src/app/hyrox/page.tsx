"use client";
import { useEffect, useState } from "react";
import { Plus, Trophy, CheckCircle2, Circle, Trash2, AlertTriangle, CalendarDays, Wand2, Pencil } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { dayKey, addDays, fmtDay, fmtDuration, parseDuration, num, weekStart, daysBetween, toLocalInput, fromLocalInput, fmtPace } from "@/lib/format";
import { ensureHyroxEvent, SESSION_TYPES, sessionLabel, HYROX_DATE, PHASES, type HyroxEvent } from "@/lib/hyrox";
import { Card, PageHeader, Spinner, ErrorBox, Button, Empty, Badge, Stat, Segmented, Select, Input, Field, Sheet, Textarea, useToast, ListRow, Confirm, Bar, cx } from "@/components/ui";
import { LineChartBox, BarChartBox } from "@/components/charts";
import { buildPlan } from "./plan-template";

type Station = { id: number; name: string; workload: string; distance_m: number | null; reps: number | null };
type Division = { code: string; name: string; format: string };
type Standard = { division_code: string; station_id: number; load_kg: number | null; load_note: string | null; reps: number | null; target_height_m: number | null; verified: boolean; rulebook_season: string };
type HSession = { id: string; event_id: string | null; session_type: string; planned_date: string | null; completed_at: string | null; status: "planned" | "completed" | "skipped" | "modified"; title: string | null; prescription: string | null; total_seconds: number | null; avg_hr: number | null; rpe: number | null; fatigue: number | null; notes: string | null };
type Result = { id: string; session_id: string | null; station_id: number; performed_on: string; weight_kg: number | null; distance_m: number | null; reps: number | null; sets: number | null; time_seconds: number | null; rest_seconds: number | null; difficulty: number | null; is_race_standard: boolean; technique_notes: string | null };
type Split = { id: string; session_id: string; split_number: number; seconds: number; avg_hr: number | null; after_station_id: number | null };
type PlanWeek = { id: string; week_start: string; phase: string; focus: string | null; planned_run_km: number | null; manually_adjusted: boolean; notes: string | null };
type Check = { id: string; item: string; category: string | null; done: boolean; sort_order: number };

type Data = { event: HyroxEvent; stations: Station[]; divisions: Division[]; standards: Standard[]; sessions: HSession[]; results: Result[]; splits: Split[]; weeks: PlanWeek[]; checklist: Check[]; runs: { started_at: string; distance_m: number }[]; readiness: { day: string; training_readiness: number | null; body_battery: number | null; sleep_minutes: number | null }[] };

export default function HyroxPage() {
  const [tab, setTab] = useState<"overview" | "plan" | "log" | "stations" | "race">("overview");
  const [logSheet, setLogSheet] = useState<{ open: boolean; s?: Partial<HSession> }>({ open: false });
  const { data, error, loading, reload } = useLive<Data>(async () => {
    const event = await ensureHyroxEvent();
    const since = addDays(dayKey(), -120);
    const [stations, divisions, standards, sessions, results, splits, weeks, checklist, runs, readiness] = await Promise.all([
      must(supabase.from("hyrox_stations").select("*").order("id")),
      must(supabase.from("hyrox_divisions").select("*").order("sort_order")),
      must(supabase.from("hyrox_division_standards").select("*")),
      must(supabase.from("hyrox_sessions").select("*").eq("event_id", event.id).order("planned_date", { ascending: true, nullsFirst: false })),
      must(supabase.from("hyrox_station_results").select("*").order("performed_on", { ascending: false }).limit(1000)),
      must(supabase.from("hyrox_run_splits").select("*").order("split_number")),
      must(supabase.from("hyrox_plan_weeks").select("*").eq("event_id", event.id).order("week_start")),
      must(supabase.from("race_checklist_items").select("*").eq("event_id", event.id).order("sort_order")),
      must(supabase.from("workouts").select("started_at, distance_m").in("type", ["run", "treadmill_run"]).gte("started_at", new Date(`${since}T00:00:00+05:30`).toISOString())),
      must(supabase.from("daily_activity").select("day, training_readiness, body_battery, sleep_minutes").order("day", { ascending: false }).limit(7)),
    ]);
    return { event, stations, divisions, standards, sessions, results, splits, weeks, checklist, runs, readiness } as Data;
  }, ["hyrox_events", "hyrox_sessions", "hyrox_station_results", "hyrox_run_splits", "hyrox_plan_weeks", "race_checklist_items", "workouts", "daily_activity"]);

  const daysToGo = daysBetween(dayKey(), HYROX_DATE);
  return (
    <>
      <PageHeader title="HYROX" subtitle={`Race day · ${fmtDay(HYROX_DATE, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`}
        action={<Button onClick={() => setLogSheet({ open: true, s: { status: "completed", session_type: "station_specific" } })}><Plus className="size-4" />Log session</Button>} />
      <div className="mb-4"><Segmented value={tab} onChange={setTab} options={[{ value: "overview", label: "Overview" }, { value: "plan", label: "Training plan" }, { value: "log", label: "Sessions" }, { value: "stations", label: "Stations" }, { value: "race", label: "Race day" }]} /></div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          {tab === "overview" && <Overview d={data} daysToGo={daysToGo} reload={reload} onOpen={(s) => setLogSheet({ open: true, s })} />}
          {tab === "plan" && <Plan d={data} reload={reload} onOpen={(s) => setLogSheet({ open: true, s })} />}
          {tab === "log" && <SessionList d={data} onOpen={(s) => setLogSheet({ open: true, s })} />}
          {tab === "stations" && <Stations d={data} reload={reload} />}
          {tab === "race" && <Race d={data} reload={reload} />}
        </>
      )}
      {data && <SessionSheet open={logSheet.open} s={logSheet.s} d={data} onClose={() => setLogSheet({ open: false })} onSaved={reload} />}
    </>
  );
}

function divisionName(d: Data) { return d.divisions.find((x) => x.code === d.event.division_code)?.name ?? "Not selected"; }

function readinessFlag(d: Data): string | null {
  const recent = d.sessions.filter((s) => s.status === "completed" && s.completed_at && daysBetween(dayKey(new Date(s.completed_at)), dayKey()) <= 3);
  const highFatigue = recent.some((s) => (s.fatigue ?? 0) >= 4 || (s.rpe ?? 0) >= 9);
  const r = d.readiness[0];
  const lowReadiness = r && r.day >= addDays(dayKey(), -1) && ((r.training_readiness != null && r.training_readiness < 40) || (r.body_battery != null && r.body_battery < 30) || (r.sleep_minutes != null && r.sleep_minutes < 360));
  if (highFatigue && lowReadiness) return "High reported fatigue and low recovery markers. Hold or reduce today's planned load — the plan will not progress automatically.";
  if (highFatigue) return "You reported high fatigue or very hard effort in the last 3 days. Consider holding today's load or swapping for recovery.";
  if (lowReadiness) return "Recovery markers are low (readiness, body battery or sleep). Consider an easier session.";
  return null;
}

// ---------------- Overview ----------------
function Overview({ d, daysToGo, reload, onOpen }: { d: Data; daysToGo: number; reload: () => void; onOpen: (s: HSession) => void }) {
  const toast = useToast();
  const today = dayKey();
  const wk = weekStart(today);
  const weekSessions = d.sessions.filter((s) => s.planned_date && s.planned_date >= wk && s.planned_date <= addDays(wk, 6));
  const doneWeek = d.sessions.filter((s) => s.status === "completed" && s.completed_at && dayKey(new Date(s.completed_at)) >= wk);
  const next = d.sessions.find((s) => s.status === "planned" && s.planned_date && s.planned_date >= today);
  const thisWeek = d.weeks.find((w) => w.week_start === wk);
  const kmWeek = d.runs.filter((r) => dayKey(new Date(r.started_at)) >= wk).reduce((a, r) => a + Number(r.distance_m) / 1000, 0);
  const flag = readinessFlag(d);
  const std = d.standards.filter((s) => s.division_code === d.event.division_code);

  // readiness score: share of the 8 stations with a race-standard effort logged + simulation done + run volume consistency
  const stationsCovered = new Set(d.results.filter((r) => r.is_race_standard).map((r) => r.station_id)).size;
  const sims = d.sessions.filter((s) => s.status === "completed" && (s.session_type === "half_simulation" || s.session_type === "full_simulation")).length;
  const weeksKm = Array.from({ length: 4 }, (_, i) => d.runs.filter((r) => { const k = dayKey(new Date(r.started_at)); return k >= addDays(wk, -7 * (i + 1)) && k < addDays(wk, -7 * i); }).reduce((a, r) => a + Number(r.distance_m) / 1000, 0));
  const consistentWeeks = weeksKm.filter((k) => k >= 15).length;
  const readiness = Math.round((stationsCovered / 8) * 50 + Math.min(sims, 3) / 3 * 25 + consistentWeeks / 4 * 25);

  const kmChart = Array.from({ length: 10 }, (_, i) => {
    const s = addDays(wk, -7 * (9 - i));
    return { week: fmtDay(s), km: Math.round(d.runs.filter((r) => { const k = dayKey(new Date(r.started_at)); return k >= s && k < addDays(s, 7); }).reduce((a, r) => a + Number(r.distance_m) / 1000, 0) * 10) / 10 };
  });

  async function setDivision(code: string) {
    const { error } = await supabase.from("hyrox_events").update({ division_code: code || null }).eq("id", d.event.id);
    if (error) toast(errMsg(error), "err"); else { toast("Division updated"); reload(); }
  }

  return (
    <div className="grid gap-3 lg:gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2 border-accent/20">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div><div className="text-xs text-accent font-semibold uppercase tracking-wider">Countdown</div><div className="text-[56px] font-bold leading-none tabular mt-1">{Math.max(0, daysToGo)}<span className="text-lg text-ink-3 font-medium ml-2">days</span></div></div>
          <Stat label="Week phase" value={thisWeek ? thisWeek.phase.replace(/^\w/, (c) => c.toUpperCase()) : "—"} sub={thisWeek?.focus ?? "Generate a plan to see phases"} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-5">
          <Stat label="Sessions this week" value={`${doneWeek.length}/${weekSessions.length}`} />
          <Stat label="Run km this week" value={num(kmWeek, 1)} sub={thisWeek?.planned_run_km ? `plan ${thisWeek.planned_run_km} km` : undefined} />
          <Stat label="Readiness" value={`${readiness}%`} sub="stations · sims · run consistency" />
        </div>
        {flag && <div className="mt-4 rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn flex gap-2"><AlertTriangle className="size-4 shrink-0 mt-0.5" />{flag}</div>}
      </Card>
      <Card title="Next session">
        {next ? (
          <button onClick={() => onOpen(next)} className="text-left w-full">
            <div className="text-lg font-semibold">{next.title || sessionLabel(next.session_type)}</div>
            <div className="text-sm text-ink-3">{fmtDay(next.planned_date!, { weekday: "long", day: "numeric", month: "short" })}</div>
            {next.prescription && <p className="text-sm text-ink-2 mt-2">{next.prescription}</p>}
            <div className="mt-3"><Badge tone="accent">Tap to log it</Badge></div>
          </button>
        ) : <Empty title="Nothing planned" body="Open Training plan to generate or add sessions." />}
      </Card>

      <Card title="Weekly running (km)" className="lg:col-span-2"><BarChartBox data={kmChart} x="week" bars={[{ key: "km", name: "km" }]} height={190} /></Card>
      <Card title="Race division" action={<Badge tone="warn">{std.some((s) => s.verified) ? "verified" : "check rulebook"}</Badge>}>
        <Select value={d.event.division_code ?? ""} onChange={(e) => setDivision(e.target.value)}>
          <option value="">Select division…</option>
          {d.divisions.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
        </Select>
        <div className="mt-3 space-y-1.5 text-sm">
          {d.stations.map((st) => {
            const s = std.find((x) => x.station_id === st.id);
            return (
              <div key={st.id} className="flex justify-between gap-2"><span className="text-ink-2">{st.id}. {st.name} <span className="text-ink-3">· {s?.reps ? `${s.reps} reps` : st.workload}</span></span>
                <span className="tabular font-medium">{s?.load_kg ? `${num(s.load_kg)} kg${st.id === 6 ? "/hand" : ""}` : s?.load_note === "Bodyweight" ? "BW" : "—"}</span></div>
            );
          })}
        </div>
        <p className="text-xs text-ink-3 mt-3">Weights seeded from published summaries of the HYROX rulebook and marked unverified — confirm against the official 26/27 rulebook for your division.</p>
      </Card>
    </div>
  );
}

// ---------------- Plan ----------------
function Plan({ d, reload, onOpen }: { d: Data; reload: () => void; onOpen: (s: HSession) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [editWeek, setEditWeek] = useState<PlanWeek | null>(null);
  const today = dayKey();
  const plannedFuture = d.sessions.filter((s) => s.status === "planned" && (s.planned_date ?? "") >= today).length;

  async function generate() {
    setBusy(true);
    try {
      const weeks = buildPlan(today);
      const existing = new Set(d.weeks.map((w) => w.week_start));
      const newWeeks = weeks.filter((w) => !existing.has(w.week_start));
      if (newWeeks.length) {
        const { error } = await supabase.from("hyrox_plan_weeks").insert(newWeeks.map((w) => ({ event_id: d.event.id, week_start: w.week_start, phase: w.phase, focus: w.focus, planned_run_km: w.planned_run_km, planned_sessions: w.sessions.length })));
        if (error) throw error;
      }
      const haveDates = new Set(d.sessions.map((s) => `${s.planned_date}|${s.session_type}`));
      const sessions = weeks.flatMap((w) => w.sessions.map((s) => ({ event_id: d.event.id, session_type: s.session_type, title: s.title, prescription: s.prescription, planned_date: addDays(w.week_start, s.offset), status: "planned" })))
        .filter((s) => !haveDates.has(`${s.planned_date}|${s.session_type}`));
      if (sessions.length) {
        const { error } = await supabase.from("hyrox_sessions").insert(sessions);
        if (error) throw error;
      }
      toast(`Plan created: ${newWeeks.length} weeks, ${sessions.length} sessions`); reload();
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  }

  async function saveWeek(e: React.FormEvent) {
    e.preventDefault(); if (!editWeek) return;
    const { error } = await supabase.from("hyrox_plan_weeks").update({ phase: editWeek.phase, focus: editWeek.focus, planned_run_km: editWeek.planned_run_km != null && String(editWeek.planned_run_km) !== "" ? Number(editWeek.planned_run_km) : null, notes: editWeek.notes, manually_adjusted: true }).eq("id", editWeek.id);
    if (error) toast(errMsg(error), "err"); else { setEditWeek(null); reload(); }
  }

  async function quick(s: HSession, status: "skipped" | "planned") {
    const { error } = await supabase.from("hyrox_sessions").update({ status, completed_at: null }).eq("id", s.id);
    if (error) toast(errMsg(error), "err"); else reload();
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="text-sm text-ink-2 max-w-2xl">{d.weeks.length ? `${d.weeks.length} weeks planned to race day · ${plannedFuture} upcoming sessions.` : "No plan yet. Generate a periodised plan (build → specific → peak → taper → race) from this week to 18 January. Everything is editable afterwards."}
            <span className="block text-xs text-ink-3 mt-1">This is a conservative template, not coaching. The app never increases load automatically; adjust weeks yourself or with your coach.</span></div>
          <Button onClick={generate} loading={busy} variant={d.weeks.length ? "secondary" : "primary"}><Wand2 className="size-4" />{d.weeks.length ? "Fill missing weeks" : "Generate plan"}</Button>
        </div>
      </Card>
      {d.weeks.map((w) => {
        const ss = d.sessions.filter((s) => s.planned_date && s.planned_date >= w.week_start && s.planned_date <= addDays(w.week_start, 6));
        const isNow = w.week_start === weekStart(today);
        const km = d.runs.filter((r) => { const k = dayKey(new Date(r.started_at)); return k >= w.week_start && k < addDays(w.week_start, 7); }).reduce((a, r) => a + Number(r.distance_m) / 1000, 0);
        return (
          <Card key={w.id} pad={false} className={cx(isNow && "border-accent/40")}
            title={<span className="flex items-center gap-2"><CalendarDays className="size-4" />Week of {fmtDay(w.week_start)}{isNow && <Badge tone="accent">this week</Badge>}</span>}
            action={<button onClick={() => setEditWeek(w)} className="text-xs text-accent flex items-center gap-1"><Pencil className="size-3" />Edit</button>}>
            <div className="px-4 lg:px-5 pb-3 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="info">{w.phase}</Badge><span className="text-ink-2">{w.focus}</span>{w.manually_adjusted && <Badge>adjusted</Badge>}
              <span className="ml-auto text-ink-3 tabular">{num(km, 1)} / {w.planned_run_km ?? "—"} km</span>
            </div>
            {w.planned_run_km ? <div className="px-4 lg:px-5 pb-3"><Bar value={km} max={Number(w.planned_run_km)} /></div> : null}
            {ss.map((s) => (
              <ListRow key={s.id} onClick={() => onOpen(s)} right={s.status === "planned" ? <button onClick={(e) => { e.stopPropagation(); quick(s, "skipped"); }} className="text-xs text-ink-3 px-2 h-8">Skip</button> : s.status === "skipped" ? <button onClick={(e) => { e.stopPropagation(); quick(s, "planned"); }} className="text-xs text-ink-3 px-2 h-8">Restore</button> : null}>
                <div className="flex items-center gap-2">
                  {s.status === "completed" ? <CheckCircle2 className="size-4 text-accent shrink-0" /> : <Circle className={cx("size-4 shrink-0", s.status === "skipped" ? "text-ink-3" : "text-ink-2")} />}
                  <span className={cx("font-medium truncate", s.status === "skipped" && "line-through text-ink-3")}>{s.title || sessionLabel(s.session_type)}</span>
                </div>
                <div className="text-xs text-ink-3 pl-6 truncate">{fmtDay(s.planned_date!, { weekday: "short", day: "numeric", month: "short" })} · {sessionLabel(s.session_type)}{s.prescription ? ` · ${s.prescription}` : ""}</div>
              </ListRow>
            ))}
            {!ss.length && <p className="px-5 pb-4 text-sm text-ink-3">No sessions this week.</p>}
          </Card>
        );
      })}
      <Sheet open={!!editWeek} onClose={() => setEditWeek(null)} title="Adjust week">
        {editWeek && (
          <form onSubmit={saveWeek} className="space-y-4">
            <Field label="Phase"><Select value={editWeek.phase} onChange={(e) => setEditWeek({ ...editWeek, phase: e.target.value })}>{PHASES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
            <Field label="Focus"><Input value={editWeek.focus ?? ""} onChange={(e) => setEditWeek({ ...editWeek, focus: e.target.value })} /></Field>
            <Field label="Planned running (km)"><Input inputMode="decimal" value={editWeek.planned_run_km ?? ""} onChange={(e) => setEditWeek({ ...editWeek, planned_run_km: e.target.value as unknown as number })} /></Field>
            <Field label="Notes"><Textarea value={editWeek.notes ?? ""} onChange={(e) => setEditWeek({ ...editWeek, notes: e.target.value })} /></Field>
            <Button size="lg" type="submit">Save week</Button>
          </form>
        )}
      </Sheet>
    </div>
  );
}

// ---------------- Sessions list ----------------
function SessionList({ d, onOpen }: { d: Data; onOpen: (s: HSession) => void }) {
  const done = d.sessions.filter((s) => s.status === "completed").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  return (
    <Card pad={false} title={`Completed sessions (${done.length})`}>
      {done.length ? done.map((s) => {
        const sp = d.splits.filter((x) => x.session_id === s.id);
        const rs = d.results.filter((x) => x.session_id === s.id);
        return (
          <ListRow key={s.id} onClick={() => onOpen(s)} right={<span className="text-sm tabular text-ink-2">{fmtDuration(s.total_seconds)}</span>}>
            <div className="font-medium truncate">{s.title || sessionLabel(s.session_type)}</div>
            <div className="text-xs text-ink-3">{fmtDay(dayKey(new Date(s.completed_at!)), { weekday: "short", day: "numeric", month: "short" })} · {sessionLabel(s.session_type)}{s.rpe ? ` · RPE ${s.rpe}` : ""}{sp.length ? ` · ${sp.length} splits` : ""}{rs.length ? ` · ${rs.length} stations` : ""}</div>
          </ListRow>
        );
      }) : <Empty title="No sessions logged yet" body="Use “Log session” to record a workout with splits and station results." />}
    </Card>
  );
}

// ---------------- Session logger ----------------
type ResRow = { key: string; id?: string; station_id: number; weight_kg: string; distance_m: string; reps: string; sets: string; time: string; rest: string; difficulty: string; is_race_standard: boolean; technique_notes: string };
type SplitRow = { key: string; time: string; avg_hr: string; after_station_id: string };

function SessionSheet({ open, s, d, onClose, onSaved }: { open: boolean; s?: Partial<HSession>; d: Data; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [res, setRes] = useState<ResRow[]>([]);
  const [splits, setSplits] = useState<SplitRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const std = d.standards.filter((x) => x.division_code === d.event.division_code);

  useEffect(() => {
    if (!open) return;
    setF({
      session_type: s?.session_type ?? "station_specific", title: s?.title ?? "", prescription: s?.prescription ?? "",
      planned_date: s?.planned_date ?? dayKey(), completed_at: toLocalInput(s?.completed_at ?? new Date().toISOString()),
      status: s?.id && s.status === "planned" ? "completed" : s?.status ?? "completed",
      total: s?.total_seconds ? fmtDuration(s.total_seconds) : "", avg_hr: s?.avg_hr ? String(s.avg_hr) : "", rpe: s?.rpe ? String(s.rpe) : "", fatigue: s?.fatigue ? String(s.fatigue) : "", notes: s?.notes ?? "",
    });
    setRes(s?.id ? d.results.filter((r) => r.session_id === s.id).map((r) => ({ key: r.id, id: r.id, station_id: r.station_id, weight_kg: r.weight_kg?.toString() ?? "", distance_m: r.distance_m?.toString() ?? "", reps: r.reps?.toString() ?? "", sets: r.sets?.toString() ?? "", time: r.time_seconds != null ? fmtDuration(r.time_seconds) : "", rest: r.rest_seconds?.toString() ?? "", difficulty: r.difficulty?.toString() ?? "", is_race_standard: r.is_race_standard, technique_notes: r.technique_notes ?? "" })) : []);
    setSplits(s?.id ? d.splits.filter((x) => x.session_id === s.id).map((x) => ({ key: x.id, time: fmtDuration(x.seconds), avg_hr: x.avg_hr?.toString() ?? "", after_station_id: x.after_station_id?.toString() ?? "" })) : []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, s?.id]);

  function addStation(id: number) {
    const st = d.stations.find((x) => x.id === id)!; const sd = std.find((x) => x.station_id === id);
    setRes((r) => [...r, { key: Math.random().toString(36), station_id: id, weight_kg: sd?.load_kg?.toString() ?? "", distance_m: st.distance_m?.toString() ?? "", reps: (sd?.reps ?? st.reps)?.toString() ?? "", sets: "1", time: "", rest: "", difficulty: "", is_race_standard: false, technique_notes: "" }]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const completed = f.status === "completed";
      const row = {
        event_id: d.event.id, session_type: f.session_type, title: f.title || null, prescription: f.prescription || null,
        planned_date: f.planned_date || null, status: f.status, completed_at: completed ? fromLocalInput(f.completed_at) : null,
        total_seconds: parseDuration(f.total ?? ""), avg_hr: f.avg_hr ? Number(f.avg_hr) : null, rpe: f.rpe ? Number(f.rpe) : null, fatigue: f.fatigue ? Number(f.fatigue) : null, notes: f.notes || null,
      };
      const saved = s?.id ? await supabase.from("hyrox_sessions").update(row).eq("id", s.id).select("id").single() : await supabase.from("hyrox_sessions").insert(row).select("id").single();
      if (saved.error) throw saved.error;
      const sid = (saved.data as { id: string }).id;
      const performed_on = completed ? dayKey(new Date(row.completed_at!)) : row.planned_date ?? dayKey();
      // replace station results & splits for this session
      if (s?.id) {
        await must(supabase.from("hyrox_station_results").delete().eq("session_id", sid));
        await must(supabase.from("hyrox_run_splits").delete().eq("session_id", sid));
      }
      const rrows = res.map((r) => ({ session_id: sid, station_id: r.station_id, performed_on, weight_kg: r.weight_kg ? Number(r.weight_kg) : null, distance_m: r.distance_m ? Number(r.distance_m) : null, reps: r.reps ? Number(r.reps) : null, sets: r.sets ? Number(r.sets) : null, time_seconds: parseDuration(r.time), rest_seconds: r.rest ? Number(r.rest) : null, difficulty: r.difficulty ? Number(r.difficulty) : null, is_race_standard: r.is_race_standard, technique_notes: r.technique_notes || null }));
      if (rrows.length) await must(supabase.from("hyrox_station_results").insert(rrows));
      const srows = splits.map((x, i) => ({ session_id: sid, split_number: i + 1, distance_m: 1000, seconds: parseDuration(x.time) ?? 0, avg_hr: x.avg_hr ? Number(x.avg_hr) : null, after_station_id: x.after_station_id ? Number(x.after_station_id) : null })).filter((x) => x.seconds > 0);
      if (srows.length) await must(supabase.from("hyrox_run_splits").insert(srows));
      toast("Session saved"); onSaved(); onClose();
    } catch (err) { toast(errMsg(err), "err"); } finally { setBusy(false); }
  }

  const avgSplit = (() => { const xs = splits.map((x) => parseDuration(x.time) ?? 0).filter((x) => x > 0); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; })();

  return (
    <Sheet open={open} onClose={onClose} title={s?.id ? (s.title || sessionLabel(s.session_type ?? "")) : "Log HYROX session"} wide>
      <form onSubmit={save} className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={f.session_type} onChange={(e) => setF({ ...f, session_type: e.target.value })}>{SESSION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="completed">Completed</option><option value="planned">Planned</option><option value="modified">Modified</option><option value="skipped">Skipped</option></Select></Field>
          <Field label="Title" className="col-span-2"><Input value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={sessionLabel(f.session_type ?? "")} /></Field>
          {f.status === "completed" ? <Field label="Completed at"><Input type="datetime-local" value={f.completed_at} onChange={(e) => setF({ ...f, completed_at: e.target.value })} /></Field>
            : <Field label="Planned date"><Input type="date" value={f.planned_date} onChange={(e) => setF({ ...f, planned_date: e.target.value })} /></Field>}
          <Field label="Total time" hint="h:mm:ss or mm:ss"><Input value={f.total ?? ""} onChange={(e) => setF({ ...f, total: e.target.value })} placeholder="45:00" /></Field>
          <Field label="Avg HR"><Input inputMode="numeric" value={f.avg_hr ?? ""} onChange={(e) => setF({ ...f, avg_hr: e.target.value })} /></Field>
          <Field label="RPE (1–10)"><Select value={f.rpe ?? ""} onChange={(e) => setF({ ...f, rpe: e.target.value })}><option value="">—</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select></Field>
          <Field label="Pre-session fatigue" hint="1 fresh · 5 exhausted"><Select value={f.fatigue ?? ""} onChange={(e) => setF({ ...f, fatigue: e.target.value })}><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
        </div>
        {f.prescription && <div className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2"><span className="text-ink-3 text-xs block mb-1">Planned</span>{f.prescription}</div>}

        <div>
          <div className="flex items-center justify-between mb-2"><h4 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">1 km run splits</h4>{avgSplit && <span className="text-xs text-ink-3">avg {fmtPace(avgSplit)}</span>}</div>
          <div className="space-y-2">
            {splits.map((x, i) => (
              <div key={x.key} className="grid grid-cols-[28px_1fr_1fr_1.4fr_36px] gap-2 items-center">
                <span className="text-sm text-ink-3 tabular">{i + 1}</span>
                <Input placeholder="4:45" value={x.time} onChange={(e) => setSplits(splits.map((y) => y.key === x.key ? { ...y, time: e.target.value } : y))} aria-label={`Split ${i + 1} time`} />
                <Input placeholder="HR" inputMode="numeric" value={x.avg_hr} onChange={(e) => setSplits(splits.map((y) => y.key === x.key ? { ...y, avg_hr: e.target.value } : y))} aria-label="Average HR" />
                <Select value={x.after_station_id} onChange={(e) => setSplits(splits.map((y) => y.key === x.key ? { ...y, after_station_id: e.target.value } : y))} aria-label="After station"><option value="">Fresh run</option>{d.stations.map((st) => <option key={st.id} value={st.id}>after {st.name}</option>)}</Select>
                <button type="button" onClick={() => setSplits(splits.filter((y) => y.key !== x.key))} className="text-ink-3 hover:text-danger" aria-label="Remove split"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <Button type="button" size="sm" variant="secondary" onClick={() => setSplits([...splits, { key: Math.random().toString(36), time: "", avg_hr: "", after_station_id: splits.length && res.length ? "" : "" }])}><Plus className="size-4" />Add split</Button>
          </div>
        </div>

        <div>
          <h4 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3 mb-2">Station work</h4>
          <div className="space-y-3">
            {res.map((r) => {
              const st = d.stations.find((x) => x.id === r.station_id)!;
              const up = (p: Partial<ResRow>) => setRes(res.map((y) => y.key === r.key ? { ...y, ...p } : y));
              return (
                <div key={r.key} className="rounded-xl bg-surface-2 p-3">
                  <div className="flex justify-between items-center mb-2"><span className="font-medium text-sm">{st.id}. {st.name}</span><button type="button" onClick={() => setRes(res.filter((y) => y.key !== r.key))} className="text-ink-3 hover:text-danger" aria-label="Remove station"><Trash2 className="size-4" /></button></div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    <Field label="kg"><Input inputMode="decimal" value={r.weight_kg} onChange={(e) => up({ weight_kg: e.target.value })} /></Field>
                    <Field label="m"><Input inputMode="decimal" value={r.distance_m} onChange={(e) => up({ distance_m: e.target.value })} /></Field>
                    <Field label="Reps"><Input inputMode="numeric" value={r.reps} onChange={(e) => up({ reps: e.target.value })} /></Field>
                    <Field label="Sets"><Input inputMode="numeric" value={r.sets} onChange={(e) => up({ sets: e.target.value })} /></Field>
                    <Field label="Time"><Input placeholder="3:20" value={r.time} onChange={(e) => up({ time: e.target.value })} /></Field>
                    <Field label="Rest s"><Input inputMode="numeric" value={r.rest} onChange={(e) => up({ rest: e.target.value })} /></Field>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2 mt-2 items-end">
                    <Field label="Technique notes"><Input value={r.technique_notes} onChange={(e) => up({ technique_notes: e.target.value })} /></Field>
                    <Field label="Difficulty"><Select value={r.difficulty} onChange={(e) => up({ difficulty: e.target.value })}><option value="">—</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select></Field>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-ink-2 mt-2"><input type="checkbox" className="size-4 accent-[#b5d86a]" checked={r.is_race_standard} onChange={(e) => up({ is_race_standard: e.target.checked })} />Full race distance at division weight (counts for personal bests)</label>
                </div>
              );
            })}
            <Select value="" onChange={(e) => e.target.value && addStation(Number(e.target.value))} aria-label="Add station"><option value="">+ Add station…</option>{d.stations.map((st) => <option key={st.id} value={st.id}>{st.id}. {st.name}</option>)}</Select>
          </div>
        </div>

        <Field label="Notes"><Textarea value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex gap-2">
          {s?.id && <Button type="button" variant="danger" onClick={() => setDel(true)}><Trash2 className="size-4" /></Button>}
          <Button type="submit" size="lg" loading={busy} className="flex-1">Save session</Button>
        </div>
      </form>
      <Confirm open={del} title="Delete session?" body="Its splits and station results will be deleted too." onClose={() => setDel(false)}
        onConfirm={async () => { const { error } = await supabase.from("hyrox_sessions").delete().eq("id", s!.id!); if (error) toast(errMsg(error), "err"); else { onSaved(); onClose(); } }} />
    </Sheet>
  );
}

// ---------------- Station trackers ----------------
function Stations({ d, reload }: { d: Data; reload: () => void }) {
  const [sel, setSel] = useState(1);
  const [add, setAdd] = useState(false);
  const st = d.stations.find((x) => x.id === sel)!;
  const rs = d.results.filter((r) => r.station_id === sel);
  const pb = rs.filter((r) => r.is_race_standard && r.time_seconds != null).sort((a, b) => a.time_seconds! - b.time_seconds!)[0];
  const chart = rs.filter((r) => r.time_seconds != null).slice().reverse().map((r) => ({ day: fmtDay(r.performed_on), time: r.time_seconds, race: r.is_race_standard ? r.time_seconds : null }));
  const sd = d.standards.find((x) => x.division_code === d.event.division_code && x.station_id === sel);
  const toast = useToast();
  const [form, setForm] = useState({ performed_on: dayKey(), weight_kg: "", distance_m: "", reps: "", sets: "1", time: "", rest: "", difficulty: "", is_race_standard: false, technique_notes: "" });
  const [del, setDel] = useState<Result | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("hyrox_station_results").insert({ station_id: sel, performed_on: form.performed_on, weight_kg: form.weight_kg ? Number(form.weight_kg) : null, distance_m: form.distance_m ? Number(form.distance_m) : null, reps: form.reps ? Number(form.reps) : null, sets: form.sets ? Number(form.sets) : null, time_seconds: parseDuration(form.time), rest_seconds: form.rest ? Number(form.rest) : null, difficulty: form.difficulty ? Number(form.difficulty) : null, is_race_standard: form.is_race_standard, technique_notes: form.technique_notes || null });
    if (error) toast(errMsg(error), "err"); else { toast("Saved"); setAdd(false); reload(); }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
        {d.stations.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)} className={cx("shrink-0 h-10 px-3 rounded-xl text-sm font-medium border", sel === x.id ? "bg-accent text-accent-ink border-accent" : "bg-surface border-line-soft text-ink-2")}>{x.id}. {x.name}</button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card title={st.name}>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Race workload" value={sd?.reps ? `${sd.reps} reps` : st.workload} />
            <Stat label="Division load" value={sd?.load_kg ? `${num(sd.load_kg)} kg` : sd?.load_note === "Bodyweight" ? "Bodyweight" : "—"} sub={sd?.load_kg && sel === 6 ? "per hand" : undefined} />
            <Stat label="Personal best" value={pb ? fmtDuration(pb.time_seconds) : "—"} sub={pb ? fmtDay(pb.performed_on) : "race-standard only"} />
            <Stat label="Efforts logged" value={rs.length} />
          </div>
          <Button className="w-full mt-4" variant="secondary" onClick={() => { setForm({ performed_on: dayKey(), weight_kg: sd?.load_kg?.toString() ?? "", distance_m: st.distance_m?.toString() ?? "", reps: (sd?.reps ?? st.reps)?.toString() ?? "", sets: "1", time: "", rest: "", difficulty: "", is_race_standard: false, technique_notes: "" }); setAdd(true); }}><Plus className="size-4" />Log {st.name}</Button>
        </Card>
        <Card title="Time trend" className="lg:col-span-2">{chart.length ? <LineChartBox data={chart} x="day" lines={[{ key: "time", name: "Time (s)", color: "#7ab8f5" }, { key: "race", name: "Race standard (s)" }]} height={200} /> : <Empty title="No timed efforts yet" />}</Card>
        <Card pad={false} title="History" className="lg:col-span-3">
          {rs.length ? rs.map((r) => (
            <ListRow key={r.id} right={<button onClick={() => setDel(r)} className="size-9 grid place-items-center text-ink-3 hover:text-danger" aria-label="Delete"><Trash2 className="size-4" /></button>}>
              <div className="flex items-center gap-2"><span className="font-medium tabular">{fmtDuration(r.time_seconds)}</span>{r.is_race_standard && <Badge tone="accent">race std</Badge>}{pb?.id === r.id && <Trophy className="size-4 text-warn" />}</div>
              <div className="text-xs text-ink-3 tabular">{fmtDay(r.performed_on)}{r.weight_kg ? ` · ${num(r.weight_kg)} kg` : ""}{r.distance_m ? ` · ${num(r.distance_m)} m` : ""}{r.reps ? ` · ${r.reps} reps` : ""}{r.sets && r.sets > 1 ? ` · ${r.sets} sets` : ""}{r.difficulty ? ` · diff ${r.difficulty}/10` : ""}{r.technique_notes ? ` · ${r.technique_notes}` : ""}</div>
            </ListRow>
          )) : <Empty title={`No ${st.name} work logged`} />}
        </Card>
      </div>
      <Sheet open={add} onClose={() => setAdd(false)} title={`Log ${st.name}`}>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Date"><Input type="date" value={form.performed_on} onChange={(e) => setForm({ ...form, performed_on: e.target.value })} /></Field>
            <Field label="Time"><Input placeholder="mm:ss" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
            <Field label="kg"><Input inputMode="decimal" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} /></Field>
            <Field label="Distance m"><Input inputMode="decimal" value={form.distance_m} onChange={(e) => setForm({ ...form, distance_m: e.target.value })} /></Field>
            <Field label="Reps"><Input inputMode="numeric" value={form.reps} onChange={(e) => setForm({ ...form, reps: e.target.value })} /></Field>
            <Field label="Sets"><Input inputMode="numeric" value={form.sets} onChange={(e) => setForm({ ...form, sets: e.target.value })} /></Field>
            <Field label="Rest (s)"><Input inputMode="numeric" value={form.rest} onChange={(e) => setForm({ ...form, rest: e.target.value })} /></Field>
            <Field label="Difficulty"><Select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}><option value="">—</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</Select></Field>
          </div>
          <Field label="Technique notes"><Textarea className="min-h-16" value={form.technique_notes} onChange={(e) => setForm({ ...form, technique_notes: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" className="size-5 accent-[#b5d86a]" checked={form.is_race_standard} onChange={(e) => setForm({ ...form, is_race_standard: e.target.checked })} />Full race distance at division weight</label>
          <Button size="lg" type="submit">Save</Button>
        </form>
      </Sheet>
      <Confirm open={!!del} title="Delete effort?" onClose={() => setDel(null)} onConfirm={async () => { const { error } = await supabase.from("hyrox_station_results").delete().eq("id", del!.id); if (error) toast(errMsg(error), "err"); else reload(); }} />
    </div>
  );
}

// ---------------- Race day ----------------
const DEFAULT_CHECKLIST = [
  ["Race ticket / QR code and photo ID", "Admin"], ["Wave start time confirmed", "Admin"], ["Running shoes (tested in training)", "Kit"],
  ["Race outfit + spare socks", "Kit"], ["Grip/chalk alternative if allowed, gloves if used in training", "Kit"], ["Garmin charged, HYROX activity profile ready", "Kit"],
  ["Pre-race meal tested in training", "Fuel"], ["Water + electrolytes", "Fuel"], ["Post-race protein and change of clothes", "Fuel"],
  ["Warm-up plan (10–15 min)", "Race"], ["Pacing plan for run 1 and each station", "Race"], ["Know the Roxzone layout once on site", "Race"],
];

function Race({ d, reload }: { d: Data; reload: () => void }) {
  const toast = useToast();
  const [item, setItem] = useState("");
  const [r, setR] = useState({ total: d.event.result_total_seconds ? fmtDuration(d.event.result_total_seconds) : "", roxzone: d.event.result_roxzone_seconds ? fmtDuration(d.event.result_roxzone_seconds) : "", rank: d.event.result_rank_overall?.toString() ?? "", ag: d.event.result_rank_age_group?.toString() ?? "", notes: d.event.result_notes ?? "", goal: d.event.goal_time_seconds ? fmtDuration(d.event.goal_time_seconds) : "", location: d.event.location ?? "" });
  const done = d.event.status === "completed";

  async function seed() {
    const { error } = await supabase.from("race_checklist_items").insert(DEFAULT_CHECKLIST.map(([it, cat], i) => ({ event_id: d.event.id, item: it, category: cat, sort_order: i })));
    if (error) toast(errMsg(error), "err"); else reload();
  }
  async function toggle(c: Check) { const { error } = await supabase.from("race_checklist_items").update({ done: !c.done }).eq("id", c.id); if (error) toast(errMsg(error), "err"); else reload(); }
  async function addItem() { if (!item.trim()) return; const { error } = await supabase.from("race_checklist_items").insert({ event_id: d.event.id, item: item.trim(), sort_order: d.checklist.length }); if (error) toast(errMsg(error), "err"); else { setItem(""); reload(); } }
  async function saveEvent(complete: boolean) {
    const total = parseDuration(r.total);
    if (complete && !total) return toast("Enter your finishing time to mark the race complete", "err");
    const { error } = await supabase.from("hyrox_events").update({
      goal_time_seconds: parseDuration(r.goal), location: r.location || null,
      result_total_seconds: total, result_roxzone_seconds: parseDuration(r.roxzone), result_rank_overall: r.rank ? Number(r.rank) : null, result_rank_age_group: r.ag ? Number(r.ag) : null, result_notes: r.notes || null,
      ...(complete ? { status: "completed", completed_at: new Date().toISOString() } : {}),
    }).eq("id", d.event.id);
    if (error) toast(errMsg(error), "err"); else { toast(complete ? "Race marked complete — training history preserved" : "Saved"); reload(); }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Race-day checklist" pad={false}>
        {d.checklist.length ? d.checklist.map((c) => (
          <ListRow key={c.id} onClick={() => toggle(c)} right={<button onClick={async (e) => { e.stopPropagation(); await supabase.from("race_checklist_items").delete().eq("id", c.id); reload(); }} className="text-ink-3 hover:text-danger size-8 grid place-items-center" aria-label="Delete item"><Trash2 className="size-4" /></button>}>
            <div className="flex items-center gap-3">{c.done ? <CheckCircle2 className="size-5 text-accent shrink-0" /> : <Circle className="size-5 text-ink-3 shrink-0" />}<span className={cx(c.done && "line-through text-ink-3")}>{c.item}</span>{c.category && <Badge>{c.category}</Badge>}</div>
          </ListRow>
        )) : <Empty title="No checklist yet" action={<Button variant="secondary" onClick={seed}>Use suggested checklist</Button>} />}
        <div className="flex gap-2 p-4 border-t border-line-soft"><Input placeholder="Add item" value={item} onChange={(e) => setItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())} /><Button variant="secondary" onClick={addItem}><Plus className="size-4" /></Button></div>
      </Card>
      <Card title={done ? "Race result" : "Goal & result"} action={done ? <Badge tone="accent">Completed</Badge> : null}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Goal time"><Input placeholder="1:25:00" value={r.goal} onChange={(e) => setR({ ...r, goal: e.target.value })} /></Field>
          <Field label="Location"><Input value={r.location} onChange={(e) => setR({ ...r, location: e.target.value })} /></Field>
          <Field label="Finish time"><Input placeholder="h:mm:ss" value={r.total} onChange={(e) => setR({ ...r, total: e.target.value })} /></Field>
          <Field label="Roxzone time"><Input placeholder="mm:ss" value={r.roxzone} onChange={(e) => setR({ ...r, roxzone: e.target.value })} /></Field>
          <Field label="Overall rank"><Input inputMode="numeric" value={r.rank} onChange={(e) => setR({ ...r, rank: e.target.value })} /></Field>
          <Field label="Age-group rank"><Input inputMode="numeric" value={r.ag} onChange={(e) => setR({ ...r, ag: e.target.value })} /></Field>
        </div>
        <Field label="Notes" className="mt-3"><Textarea value={r.notes} onChange={(e) => setR({ ...r, notes: e.target.value })} /></Field>
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" onClick={() => saveEvent(false)} className="flex-1">Save</Button>
          {!done && <Button onClick={() => saveEvent(true)} className="flex-1" disabled={dayKey() < HYROX_DATE}><Trophy className="size-4" />Mark race complete</Button>}
        </div>
        {!done && dayKey() < HYROX_DATE && <p className="text-xs text-ink-3 mt-2">The race can be marked complete from race day onwards. All training history is kept.</p>}
      </Card>
    </div>
  );
}
