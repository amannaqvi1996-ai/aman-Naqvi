"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { dayKey, fmtDay, num } from "@/lib/format";
import { Card, PageHeader, Spinner, ErrorBox, Button, Empty, Sheet, Field, Input, Textarea, Stat, Confirm, useToast, ListRow, Segmented } from "@/components/ui";
import { LineChartBox } from "@/components/charts";

type W = { id: string; measured_on: string; weight_kg: number | null; waist_cm: number | null; notes: string | null };

export default function BodyPage() {
  const toast = useToast();
  const [range, setRange] = useState<"30" | "90" | "365">("90");
  const [edit, setEdit] = useState<Partial<W> | null>(null);
  const [del, setDel] = useState<W | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useLive(async () => (await must(supabase.from("weight_records").select("*").order("measured_on", { ascending: false }).limit(730))) as W[], ["weight_records"]);

  const all = data ?? [];
  const cutoff = new Date(Date.now() - Number(range) * 86400000).toISOString().slice(0, 10);
  const series = all.filter((w) => w.measured_on >= cutoff).slice().reverse().map((w) => ({ day: fmtDay(w.measured_on), weight: w.weight_kg != null ? Number(w.weight_kg) : null, waist: w.waist_cm != null ? Number(w.waist_cm) : null }));
  const weights = all.filter((w) => w.weight_kg != null);
  const waists = all.filter((w) => w.waist_cm != null);
  const latest = weights[0], first = weights[weights.length - 1];
  const weekAgo = weights.find((w) => w.measured_on <= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  // 7-day average
  const avg7 = (() => { const c = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10); const xs = weights.filter((w) => w.measured_on > c).map((w) => Number(w.weight_kg)); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; })();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const weight = edit.weight_kg != null && String(edit.weight_kg) !== "" ? Number(edit.weight_kg) : null;
    const waist = edit.waist_cm != null && String(edit.waist_cm) !== "" ? Number(edit.waist_cm) : null;
    if (weight == null && waist == null) return toast("Enter weight or waist", "err");
    setBusy(true);
    const row = { measured_on: edit.measured_on || dayKey(), weight_kg: weight, waist_cm: waist, notes: edit.notes || null };
    const { error } = await supabase.from("weight_records").upsert(row, { onConflict: "user_id,measured_on" });
    setBusy(false);
    if (error) toast(errMsg(error), "err"); else { toast("Saved"); setEdit(null); reload(); }
  }

  return (
    <>
      <PageHeader title="Weight" subtitle="Weight and waist measurements" action={<Button onClick={() => setEdit({ measured_on: dayKey() })}><Plus className="size-4" />Log</Button>} />
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : (
        <div className="grid gap-3 lg:gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Latest" value={latest ? num(latest.weight_kg, 1) : "—"} unit="kg" sub={latest ? fmtDay(latest.measured_on) : undefined} />
              <Stat label="7-day average" value={avg7 != null ? num(avg7, 1) : "—"} unit="kg" />
              <Stat label="vs a week ago" value={latest && weekAgo ? `${Number(latest.weight_kg) - Number(weekAgo.weight_kg) > 0 ? "+" : ""}${num(Number(latest.weight_kg) - Number(weekAgo.weight_kg), 1)}` : "—"} unit="kg" />
              <Stat label="Since first log" value={latest && first && latest !== first ? `${Number(latest.weight_kg) - Number(first.weight_kg) > 0 ? "+" : ""}${num(Number(latest.weight_kg) - Number(first.weight_kg), 1)}` : "—"} unit="kg" sub={waists[0] ? `Waist ${num(waists[0].waist_cm, 1)} cm` : undefined} />
            </div>
          </Card>
          <Card title="Weight" className="lg:col-span-2" action={<Segmented value={range} onChange={setRange} options={[{ value: "30", label: "30d" }, { value: "90", label: "90d" }, { value: "365", label: "1y" }]} />}>
            {series.some((s) => s.weight != null) ? <LineChartBox data={series} x="day" lines={[{ key: "weight", name: "Weight (kg)" }]} /> : <Empty title="No weigh-ins in this range" />}
          </Card>
          <Card title="Waist">
            {series.some((s) => s.waist != null) ? <LineChartBox data={series} x="day" lines={[{ key: "waist", name: "Waist (cm)", color: "#7ab8f5" }]} height={220} /> : <Empty title="No waist measurements" />}
          </Card>
          <Card title="History" pad={false} className="lg:col-span-3">
            {all.length ? all.slice(0, 60).map((w) => (
              <ListRow key={w.id} onClick={() => setEdit(w)} right={<button onClick={(e) => { e.stopPropagation(); setDel(w); }} className="size-9 grid place-items-center text-ink-3 hover:text-danger" aria-label="Delete"><Trash2 className="size-4" /></button>}>
                <div className="flex justify-between gap-3"><span className="font-medium">{fmtDay(w.measured_on, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className="tabular text-ink-2">{w.weight_kg != null ? `${num(w.weight_kg, 1)} kg` : ""}{w.weight_kg != null && w.waist_cm != null ? " · " : ""}{w.waist_cm != null ? `${num(w.waist_cm, 1)} cm` : ""}</span></div>
                {w.notes && <div className="text-xs text-ink-3 truncate">{w.notes}</div>}
              </ListRow>
            )) : <Empty title="No measurements yet" body="Log your first weigh-in to start the trend." />}
          </Card>
        </div>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Log measurement">
        {edit && (
          <form onSubmit={save} className="space-y-4">
            <Field label="Date"><Input type="date" max={dayKey()} value={edit.measured_on ?? dayKey()} onChange={(e) => setEdit({ ...edit, measured_on: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Weight (kg)"><Input inputMode="decimal" autoFocus value={edit.weight_kg ?? ""} onChange={(e) => setEdit({ ...edit, weight_kg: e.target.value as unknown as number })} /></Field>
              <Field label="Waist (cm)"><Input inputMode="decimal" value={edit.waist_cm ?? ""} onChange={(e) => setEdit({ ...edit, waist_cm: e.target.value as unknown as number })} /></Field>
            </div>
            <Field label="Notes"><Textarea value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className="min-h-16" /></Field>
            <p className="text-xs text-ink-3">One record per day — saving again for the same date updates it.</p>
            <Button size="lg" type="submit" loading={busy}>Save</Button>
          </form>
        )}
      </Sheet>
      <Confirm open={!!del} title="Delete measurement?" onClose={() => setDel(null)}
        onConfirm={async () => { const { error } = await supabase.from("weight_records").delete().eq("id", del!.id); if (error) toast(errMsg(error), "err"); else reload(); }} />
    </>
  );
}
