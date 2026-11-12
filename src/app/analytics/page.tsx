"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { dayKey, addDays, fmtDay, num, weekStart } from "@/lib/format";
import { useAuth } from "@/components/auth";
import { Card, PageHeader, Spinner, ErrorBox, Segmented, Stat, Empty } from "@/components/ui";
import { BarChartBox, LineChartBox } from "@/components/charts";
import { STATUSES, type JStatus } from "../aor/types";

export default function AnalyticsPage() {
  const { profile } = useAuth();
  const [range, setRange] = useState<"28" | "84" | "182">("28");
  const days = Number(range);
  const today = dayKey();
  const from = addDays(today, -(days - 1));
  const fromIso = new Date(`${from}T00:00:00+05:30`).toISOString();

  const { data, error, loading, reload } = useLive(async () => {
    const [food, weight, runs, study, judg, hx, act] = await Promise.all([
      must(supabase.from("nutrition_entries").select("consumed_at, calories_kcal, protein_g").gte("consumed_at", fromIso).limit(10000)),
      must(supabase.from("weight_records").select("measured_on, weight_kg, waist_cm").gte("measured_on", from).order("measured_on")),
      must(supabase.from("workouts").select("started_at, distance_m, type, duration_seconds").gte("started_at", fromIso)),
      must(supabase.from("study_sessions").select("started_at, duration_minutes").gte("started_at", fromIso)),
      must(supabase.from("judgments").select("status")),
      must(supabase.from("hyrox_sessions").select("completed_at, status").eq("status", "completed").gte("completed_at", fromIso)),
      must(supabase.from("daily_activity").select("day, steps, sleep_minutes").gte("day", from)),
    ]);
    return { food, weight, runs, study, judg, hx, act } as {
      food: { consumed_at: string; calories_kcal: number; protein_g: number }[]; weight: { measured_on: string; weight_kg: number | null; waist_cm: number | null }[];
      runs: { started_at: string; distance_m: number | null; type: string; duration_seconds: number | null }[]; study: { started_at: string; duration_minutes: number | null }[];
      judg: { status: JStatus }[]; hx: { completed_at: string }[]; act: { day: string; steps: number | null; sleep_minutes: number | null }[];
    };
  }, ["nutrition_entries", "weight_records", "workouts", "study_sessions", "judgments", "hyrox_sessions", "daily_activity"], [range]);

  const kcalT = profile?.calorie_target_kcal ?? 1500, protT = profile?.protein_target_g ?? 120;
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
  const weeks = Array.from(new Set(dayList.map(weekStart)));

  const content = data && (() => {
    const byDay = new Map<string, { k: number; p: number }>();
    data.food.forEach((f) => { const d = dayKey(new Date(f.consumed_at)); const x = byDay.get(d) ?? { k: 0, p: 0 }; x.k += Number(f.calories_kcal); x.p += Number(f.protein_g); byDay.set(d, x); });
    const nut = dayList.map((d) => ({ day: fmtDay(d), kcal: byDay.has(d) ? Math.round(byDay.get(d)!.k) : null, protein: byDay.has(d) ? Math.round(byDay.get(d)!.p) : null }));
    const logged = [...byDay.values()];
    const avgK = logged.length ? logged.reduce((a, x) => a + x.k, 0) / logged.length : null;
    const avgP = logged.length ? logged.reduce((a, x) => a + x.p, 0) / logged.length : null;
    const proteinHit = logged.filter((x) => x.p >= protT).length;
    const isRun = (t: string) => t === "run" || t === "treadmill_run";
    const wk = weeks.map((w) => {
      const inW = (iso: string) => { const k = dayKey(new Date(iso)); return k >= w && k < addDays(w, 7); };
      return {
        week: fmtDay(w),
        km: Math.round(data.runs.filter((r) => isRun(r.type) && inW(r.started_at)).reduce((a, r) => a + Number(r.distance_m ?? 0) / 1000, 0) * 10) / 10,
        study: Math.round(data.study.filter((s) => inW(s.started_at)).reduce((a, s) => a + (s.duration_minutes ?? 0), 0) / 6) / 10,
        hyrox: data.hx.filter((s) => inW(s.completed_at)).length,
        workouts: data.runs.filter((r) => inW(r.started_at)).length,
      };
    });
    const weight = data.weight.map((w) => ({ day: fmtDay(w.measured_on), weight: w.weight_kg != null ? Number(w.weight_kg) : null, waist: w.waist_cm != null ? Number(w.waist_cm) : null }));
    const wts = data.weight.filter((w) => w.weight_kg != null);
    const wChange = wts.length >= 2 ? Number(wts[wts.length - 1].weight_kg) - Number(wts[0].weight_kg) : null;
    const status = STATUSES.map((s) => ({ status: s.short, count: data.judg.filter((j) => j.status === s.value).length }));
    const studyHrs = data.study.reduce((a, s) => a + (s.duration_minutes ?? 0), 0) / 60;
    const totalKm = data.runs.filter((r) => isRun(r.type)).reduce((a, r) => a + Number(r.distance_m ?? 0) / 1000, 0);
    const sleep = data.act.filter((a) => a.sleep_minutes).map((a) => Number(a.sleep_minutes));

    return (
      <div className="grid gap-3 lg:gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <Stat label="Avg calories" value={avgK != null ? num(avgK) : "—"} sub={`${logged.length} days logged`} />
            <Stat label="Avg protein" value={avgP != null ? num(avgP) : "—"} unit="g" sub={`target hit ${proteinHit}/${logged.length} days`} />
            <Stat label="Weight change" value={wChange != null ? `${wChange > 0 ? "+" : ""}${num(wChange, 1)}` : "—"} unit="kg" />
            <Stat label="Running" value={num(totalKm, 1)} unit="km" />
            <Stat label="AOR study" value={num(studyHrs, 1)} unit="h" />
            <Stat label="Avg sleep" value={sleep.length ? num(sleep.reduce((a, b) => a + b, 0) / sleep.length / 60, 1) : "—"} unit="h" />
          </div>
        </Card>
        <Card title="Daily calories"><BarChartBox data={nut} x="day" bars={[{ key: "kcal", name: "kcal" }]} refY={kcalT} refLabel={`${kcalT}`} /></Card>
        <Card title="Daily protein (g)"><BarChartBox data={nut} x="day" bars={[{ key: "protein", name: "g", color: "#7ab8f5" }]} refY={protT} refLabel={`${protT} g`} /></Card>
        <Card title="Weight & waist">{weight.length ? <LineChartBox data={weight} x="day" lines={[{ key: "weight", name: "Weight (kg)" }, { key: "waist", name: "Waist (cm)", color: "#7ab8f5" }]} /> : <Empty title="No measurements in this range" />}</Card>
        <Card title="Weekly running (km)"><BarChartBox data={wk} x="week" bars={[{ key: "km", name: "km" }]} /></Card>
        <Card title="AOR study (hours per week)"><BarChartBox data={wk} x="week" bars={[{ key: "study", name: "hours", color: "#7ab8f5" }]} /></Card>
        <Card title="AOR syllabus status"><BarChartBox data={status} x="status" bars={[{ key: "count", name: "judgments", color: "#7ab8f5" }]} /></Card>
        <Card title="HYROX sessions completed per week" className="lg:col-span-2"><BarChartBox data={wk} x="week" bars={[{ key: "hyrox", name: "sessions" }, { key: "workouts", name: "all workouts", color: "#3a3a40" }]} /></Card>
      </div>
    );
  })();

  return (
    <>
      <PageHeader title="Analytics" subtitle="Trends across every module" action={<Segmented value={range} onChange={setRange} options={[{ value: "28", label: "4 wk" }, { value: "84", label: "12 wk" }, { value: "182", label: "6 mo" }]} />} />
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : content}
    </>
  );
}
