"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Footprints, Scale, Flame, BookOpen, Timer, NotebookPen } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { dayKey, fmtDay, num, fmtDuration } from "@/lib/format";
import { ensureHyroxEvent, sessionLabel, HYROX_DATE } from "@/lib/hyrox";
import { useAuth } from "@/components/auth";
import { Card, PageHeader, Ring, Bar, Stat, Spinner, ErrorBox, Button, Textarea, useToast, Badge } from "@/components/ui";
import { QuickFoodButton } from "./nutrition/quick-add";

type CC = {
  day: string;
  aor: { daily_target: number; studied_today: number; minutes_today: number; total: number; first_read: number; due_reviews: number };
  hyrox: null | { event_id: string; event_date: string; days_to_go: number; division: string | null; next_session: null | { id: string; title: string | null; session_type: string; planned_date: string }; week_sessions_done: number; week_sessions_planned: number };
  fitness: { steps: number | null; week_run_km: number; workouts_today: { id: string; type: string; title: string | null; duration_seconds: number | null; distance_m: number | null }[] };
  nutrition: { calories: number; protein_g: number; calorie_target: number; protein_target: number; estimated_entries: number };
  reading: { pages_today: number };
};

const DIVISION_NAMES: Record<string, string> = { men_open: "Men's Open", men_pro: "Men's Pro", women_open: "Women's Open", women_pro: "Women's Pro", doubles_men: "Doubles Men", doubles_men_pro: "Doubles Men Pro", doubles_mixed: "Doubles Mixed", doubles_women: "Doubles Women", doubles_women_pro: "Doubles Women Pro" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Today() {
  const { profile } = useAuth();
  const today = dayKey();
  const { data, error, loading, reload } = useLive(async () => {
    await ensureHyroxEvent();
    const [cc, weight, diary] = await Promise.all([
      must(supabase.rpc("command_centre")),
      must(supabase.from("weight_records").select("measured_on, weight_kg, waist_cm").not("weight_kg", "is", null).order("measured_on", { ascending: false }).limit(2)),
      must(supabase.from("diary_entries").select("id, body, version").eq("entry_date", today).eq("kind", "daily").maybeSingle()),
    ]);
    return { cc: cc as CC, weight: weight as { measured_on: string; weight_kg: number }[], diary: diary as { id: string; body: string; version: number } | null };
  }, ["nutrition_entries", "study_sessions", "judgments", "hyrox_sessions", "workouts", "daily_activity", "weight_records", "diary_entries", "hyrox_events"]);

  const name = profile?.display_name?.split(" ")[0];
  return (
    <>
      <PageHeader title={`${greeting()}${name ? `, ${name}` : ""}`} subtitle={fmtDay(today, { weekday: "long", day: "numeric", month: "long" })} />
      {loading && !data && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data && <Dashboard cc={data.cc} weight={data.weight} diary={data.diary} reload={reload} />}
    </>
  );
}

function Dashboard({ cc, weight, diary, reload }: { cc: CC; weight: { measured_on: string; weight_kg: number }[]; diary: { id: string; body: string; version: number } | null; reload: () => void }) {
  const n = cc.nutrition, a = cc.aor, h = cc.hyrox, f = cc.fitness;
  const daysToGo = h?.days_to_go ?? 0;
  const calLeft = Math.round(n.calorie_target - n.calories);
  const w0 = weight[0], w1 = weight[1];
  return (
    <div className="grid gap-3 lg:gap-4 lg:grid-cols-3">
      {/* HYROX countdown hero */}
      <Link href="/hyrox/" className="lg:col-span-2 block rounded-[var(--radius-card)] p-5 lg:p-6 border border-accent/20 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(181,216,106,.16),transparent_55%),var(--color-surface)]">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-accent text-xs font-semibold uppercase tracking-wider"><Flame className="size-4" />HYROX · {fmtDay(HYROX_DATE, { day: "numeric", month: "long", year: "numeric" })}</div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-[56px] lg:text-[64px] font-bold leading-none tabular tracking-tight">{Math.max(0, daysToGo)}</span>
              <span className="text-ink-2 text-lg">days to go</span>
            </div>
            <div className="text-ink-3 text-sm mt-2">{Math.floor(Math.max(0, daysToGo) / 7)} weeks · {h?.division ? (DIVISION_NAMES[h.division] ?? h.division) : "Division not set"}</div>
          </div>
          <ChevronRight className="size-5 text-ink-3" />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="This week" value={`${h?.week_sessions_done ?? 0}/${h?.week_sessions_planned ?? 0}`} sub="sessions" />
          <Stat label="Run volume" value={num(f.week_run_km, 1)} unit="km" sub="this week" />
          <div className="min-w-0">
            <div className="text-xs text-ink-3 font-medium">Next session</div>
            {h?.next_session ? (
              <div className="mt-0.5"><div className="font-semibold truncate">{h.next_session.title || sessionLabel(h.next_session.session_type)}</div><div className="text-xs text-ink-3">{fmtDay(h.next_session.planned_date, { weekday: "short", day: "numeric", month: "short" })}</div></div>
            ) : <div className="text-sm text-ink-3 mt-1">None planned</div>}
          </div>
        </div>
      </Link>

      {/* Nutrition */}
      <Card title="Nutrition" action={<Link href="/nutrition/" className="text-xs text-accent">Open</Link>}>
        <div className="flex items-center gap-4">
          <Ring value={n.calories} max={n.calorie_target} color={n.calories > n.calorie_target ? "var(--color-warn)" : "var(--color-accent)"}>
            <div><div className="text-lg font-bold tabular leading-none">{num(n.calories)}</div><div className="text-[10px] text-ink-3 mt-0.5">of {num(n.calorie_target)}</div></div>
          </Ring>
          <div className="flex-1 space-y-3">
            <div>
              <div className="flex justify-between text-sm"><span className="text-ink-2">Remaining</span><span className={`tabular font-semibold ${calLeft < 0 ? "text-warn" : ""}`}>{num(calLeft)} kcal</span></div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1"><span className="text-ink-2">Protein</span><span className="tabular font-semibold">{num(n.protein_g)} / {n.protein_target} g</span></div>
              <Bar value={n.protein_g} max={n.protein_target} color={n.protein_g >= n.protein_target ? "bg-accent" : "bg-info"} />
            </div>
          </div>
        </div>
        {n.estimated_entries > 0 && <p className="text-xs text-ink-3 mt-3">{n.estimated_entries} estimated {n.estimated_entries === 1 ? "entry" : "entries"} today</p>}
        <QuickFoodButton onSaved={reload} className="mt-3 w-full" />
      </Card>

      {/* AOR */}
      <Card title="AOR preparation" action={<Link href="/aor/" className="text-xs text-accent">Open</Link>}>
        <div className="flex items-center gap-4">
          <Ring value={a.first_read} max={Math.max(a.total, 1)} color="var(--color-info)">
            <div><div className="text-lg font-bold tabular leading-none">{a.total ? Math.round((a.first_read / a.total) * 100) : 0}%</div><div className="text-[10px] text-ink-3 mt-0.5">syllabus</div></div>
          </Ring>
          <div className="grid grid-cols-2 gap-3 flex-1">
            <Stat label="Today" value={`${a.studied_today}/${a.daily_target}`} sub="judgments" />
            <Stat label="Studied" value={a.minutes_today} unit="min" />
            <Stat label="Due reviews" value={a.due_reviews} />
            <Stat label="First read" value={`${a.first_read}/${a.total}`} />
          </div>
        </div>
        {a.total === 0 && <p className="text-xs text-ink-3 mt-3">Import your prescribed judgments to start tracking.</p>}
        <Link href="/aor/" className="mt-3 flex items-center justify-center gap-2 h-10 rounded-xl bg-surface-2 text-sm font-medium"><Timer className="size-4" />Start study session</Link>
      </Card>

      {/* Fitness */}
      <Card title="Activity today" action={<Link href="/fitness/" className="text-xs text-accent">Open</Link>}>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Steps" value={f.steps != null ? num(f.steps) : "—"} sub={f.steps == null ? "not logged" : undefined} />
          <Stat label="Workouts" value={f.workouts_today.length} />
        </div>
        <div className="mt-3 space-y-1.5">
          {f.workouts_today.map((w) => (
            <div key={w.id} className="flex items-center gap-2 text-sm"><Footprints className="size-4 text-accent" /><span className="flex-1 truncate">{w.title || w.type.replace(/_/g, " ")}</span><span className="text-ink-3 tabular">{w.distance_m ? `${num(w.distance_m / 1000, 1)} km · ` : ""}{fmtDuration(w.duration_seconds)}</span></div>
          ))}
          {!f.workouts_today.length && <p className="text-sm text-ink-3">No workouts logged yet today.</p>}
        </div>
      </Card>

      {/* Weight */}
      <Card title="Weight" action={<Link href="/body/" className="text-xs text-accent">Log</Link>}>
        {w0 ? (
          <div className="flex items-end justify-between">
            <Stat label={fmtDay(w0.measured_on)} value={num(w0.weight_kg, 1)} unit="kg" />
            {w1 && <Badge tone={w0.weight_kg <= w1.weight_kg ? "accent" : "warn"}>{w0.weight_kg - w1.weight_kg > 0 ? "+" : ""}{num(w0.weight_kg - w1.weight_kg, 1)} kg</Badge>}
          </div>
        ) : <p className="text-sm text-ink-3"><Scale className="inline size-4 mr-1" />No weigh-ins yet.</p>}
        <div className="mt-3 flex items-center gap-2 text-sm text-ink-3"><BookOpen className="size-4" />{cc.reading.pages_today} pages read today</div>
      </Card>

      {/* Quick journal */}
      <QuickJournal diary={diary} onSaved={reload} />
    </div>
  );
}

function QuickJournal({ diary, onSaved }: { diary: { id: string; body: string; version: number } | null; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const stamp = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
      if (diary) {
        const body = (diary.body ? diary.body + "\n\n" : "") + `${stamp} — ${text.trim()}`;
        const { error } = await supabase.from("diary_entries").update({ body, version: diary.version }).eq("id", diary.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("diary_entries").insert({ entry_date: dayKey(), kind: "daily", body: `${stamp} — ${text.trim()}` });
        if (error) throw error;
      }
      setText(""); toast("Added to today's diary"); onSaved();
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  }
  return (
    <Card title="Quick journal" className="lg:col-span-1" action={<Link href="/diary/" className="text-xs text-accent">Diary</Link>}>
      <Textarea placeholder="What's on your mind?" value={text} onChange={(e) => setText(e.target.value)} className="min-h-20" />
      <div className="mt-2 flex justify-between items-center">
        <span className="text-xs text-ink-3"><NotebookPen className="inline size-3.5 mr-1" />Appends to today&apos;s entry</span>
        <Button size="sm" onClick={save} loading={busy} disabled={!text.trim()}>Save</Button>
      </div>
    </Card>
  );
}
