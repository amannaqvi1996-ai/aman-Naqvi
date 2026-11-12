"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Droplets, Plus, Trash2, Star, Info } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { dayKey, addDays, fmtDay, fmtTime, num, dayStartISO, dayEndISO } from "@/lib/format";
import { useAuth } from "@/components/auth";
import { Card, PageHeader, Ring, Bar, Spinner, ErrorBox, Button, Empty, Badge, Confirm, Sheet, Field, Input, Segmented, useToast, ListRow } from "@/components/ui";
import { FoodSheet, MEALS, type Entry, type Food } from "./quick-add";

export default function NutritionPage() {
  const { profile } = useAuth();
  const [day, setDay] = useState(dayKey());
  const [tab, setTab] = useState<"day" | "library">("day");
  const [sheet, setSheet] = useState<{ open: boolean; entry?: Entry | null }>({ open: false });
  const [del, setDel] = useState<Entry | null>(null);
  const toast = useToast();

  const { data, error, loading, reload } = useLive(async () => {
    const [entries, water] = await Promise.all([
      must(supabase.from("nutrition_entries").select("*").gte("consumed_at", dayStartISO(day)).lt("consumed_at", dayEndISO(day)).order("consumed_at")),
      must(supabase.from("water_logs").select("amount_ml").gte("logged_at", dayStartISO(day)).lt("logged_at", dayEndISO(day))),
    ]);
    return { entries: entries as Entry[], water: (water as { amount_ml: number }[]).reduce((s, w) => s + w.amount_ml, 0) };
  }, ["nutrition_entries", "water_logs"], [day]);

  const kcalTarget = profile?.calorie_target_kcal ?? 1500;
  const proteinTarget = profile?.protein_target_g ?? 120;
  const waterTarget = profile?.water_target_ml ?? 3000;
  const totals = (data?.entries ?? []).reduce((t, e) => ({ kcal: t.kcal + Number(e.calories_kcal), p: t.p + Number(e.protein_g), c: t.c + Number(e.carbs_g), f: t.f + Number(e.fat_g), est: t.est + (e.confidence === "estimated" ? 1 : 0) }), { kcal: 0, p: 0, c: 0, f: 0, est: 0 });
  const isToday = day === dayKey();

  async function addWater(ml: number) {
    const loggedAt = isToday ? new Date().toISOString() : new Date(`${day}T12:00:00+05:30`).toISOString();
    const { error } = await supabase.from("water_logs").insert({ amount_ml: ml, logged_at: loggedAt });
    if (error) toast(errMsg(error), "err"); else { toast(`+${ml} ml water`); reload(); }
  }

  return (
    <>
      <PageHeader title="Nutrition" subtitle="Calories, protein and water" action={<Button onClick={() => setSheet({ open: true, entry: null })}><Plus className="size-4" />Log</Button>} />
      <div className="mb-4"><Segmented value={tab} onChange={setTab} options={[{ value: "day", label: "Daily log" }, { value: "library", label: "Food library" }]} /></div>

      {tab === "library" ? <FoodLibrary /> : (
        <>
          <div className="flex items-center justify-between mb-3">
            <button className="size-10 grid place-items-center rounded-full bg-surface-2" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><ChevronLeft className="size-5" /></button>
            <div className="text-center">
              <div className="font-semibold">{isToday ? "Today" : fmtDay(day, { weekday: "long" })}</div>
              <div className="text-xs text-ink-3">{fmtDay(day, { day: "numeric", month: "long", year: "numeric" })}</div>
            </div>
            <button className="size-10 grid place-items-center rounded-full bg-surface-2 disabled:opacity-30" disabled={isToday} onClick={() => setDay(addDays(day, 1))} aria-label="Next day"><ChevronRight className="size-5" /></button>
          </div>
          {error && <ErrorBox error={error} onRetry={reload} />}
          {loading && !data ? <Spinner /> : data && (
            <div className="grid gap-3 lg:gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <Ring value={totals.kcal} max={kcalTarget} size={132} stroke={12} color={totals.kcal > kcalTarget ? "var(--color-warn)" : "var(--color-accent)"}>
                    <div><div className="text-2xl font-bold tabular">{num(totals.kcal)}</div><div className="text-xs text-ink-3">of {num(kcalTarget)} kcal</div></div>
                  </Ring>
                  <div className="flex-1 w-full space-y-3">
                    <div className="flex justify-between"><span className="text-ink-2 text-sm">Remaining</span><span className={`font-semibold tabular ${kcalTarget - totals.kcal < 0 ? "text-warn" : ""}`}>{num(kcalTarget - totals.kcal)} kcal</span></div>
                    <Macro label="Protein" v={totals.p} target={proteinTarget} color="bg-info" />
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex justify-between"><span className="text-ink-3">Carbs</span><span className="tabular">{num(totals.c)} g</span></div>
                      <div className="flex justify-between"><span className="text-ink-3">Fat</span><span className="tabular">{num(totals.f)} g</span></div>
                    </div>
                    {totals.est > 0 && <p className="text-xs text-ink-3">{totals.est} of {data.entries.length} entries are estimates.</p>}
                  </div>
                </div>
              </Card>
              <Card title="Water">
                <div className="flex items-baseline gap-1 mb-2"><span className="text-2xl font-bold tabular">{num(data.water / 1000, 2)}</span><span className="text-ink-3 text-sm">/ {num(waterTarget / 1000, 1)} L</span></div>
                <Bar value={data.water} max={waterTarget} color="bg-info" />
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[250, 500, 750].map((ml) => <Button key={ml} variant="secondary" size="sm" onClick={() => addWater(ml)}><Droplets className="size-4" />{ml}</Button>)}
                </div>
              </Card>

              <div className="lg:col-span-3 grid gap-3 lg:grid-cols-2">
                {MEALS.map((m) => {
                  const items = data.entries.filter((e) => e.meal === m.value);
                  const kcal = items.reduce((s, e) => s + Number(e.calories_kcal), 0);
                  if (!items.length && m.value === "other") return null;
                  return (
                    <Card key={m.value} pad={false} title={m.label} action={<span className="text-xs text-ink-3 tabular">{num(kcal)} kcal</span>}>
                      <div className="pb-1">
                        {items.map((e) => (
                          <ListRow key={e.id} onClick={() => setSheet({ open: true, entry: e })}
                            right={<button onClick={(ev) => { ev.stopPropagation(); setDel(e); }} className="size-9 grid place-items-center rounded-full text-ink-3 hover:text-danger" aria-label={`Delete ${e.food_name}`}><Trash2 className="size-4" /></button>}>
                            <div className="flex items-center gap-2"><span className="font-medium truncate">{e.food_name}</span>{e.confidence === "verified" ? <Badge tone="accent">Verified</Badge> : <Badge>Est.</Badge>}</div>
                            <div className="text-xs text-ink-3 tabular mt-0.5">{e.portion} · {fmtTime(e.consumed_at)} · {num(e.calories_kcal)} kcal · P {num(e.protein_g)} g</div>
                          </ListRow>
                        ))}
                        {!items.length && <p className="px-4 pb-3 text-sm text-ink-3">Nothing logged.</p>}
                      </div>
                    </Card>
                  );
                })}
              </div>

              <Card className="lg:col-span-3">
                <div className="flex gap-3 text-sm text-ink-2">
                  <Info className="size-5 shrink-0 text-warn mt-0.5" />
                  <p>Exercise calories are <b>not</b> added back to your allowance. A {num(kcalTarget)} kcal target is low for someone in HYROX training — if you notice persistent fatigue, poor recovery, dizziness or stalled performance, raise the target and check it with a doctor or registered dietitian rather than cutting further. <Link className="text-accent" href="/settings/">Edit targets</Link></p>
                </div>
              </Card>
            </div>
          )}
        </>
      )}
      <FoodSheet open={sheet.open} entry={sheet.entry} defaultDate={day} onClose={() => setSheet({ open: false })} onSaved={reload} />
      <Confirm open={!!del} title="Delete entry?" body={del ? `${del.food_name} · ${num(del.calories_kcal)} kcal` : ""} onClose={() => setDel(null)}
        onConfirm={async () => { const { error } = await supabase.from("nutrition_entries").delete().eq("id", del!.id); if (error) toast(errMsg(error), "err"); else { toast("Deleted"); reload(); } }} />
    </>
  );
}

function Macro({ label, v, target, color }: { label: string; v: number; target: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1"><span className="text-ink-2">{label}</span><span className="tabular font-semibold">{num(v)} / {target} g</span></div>
      <Bar value={v} max={target} color={v >= target ? "bg-accent" : color} />
    </div>
  );
}

function FoodLibrary() {
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<Food> | null>(null);
  const [del, setDel] = useState<Food | null>(null);
  const { data, error, loading, reload } = useLive(async () => (await must(supabase.from("saved_foods").select("*").order("is_favourite", { ascending: false }).order("name"))) as Food[], ["saved_foods"]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit?.name || !edit.portion_label) return;
    const row = { name: edit.name, portion_label: edit.portion_label, calories_kcal: Number(edit.calories_kcal) || 0, protein_g: Number(edit.protein_g) || 0, carbs_g: Number(edit.carbs_g) || 0, fat_g: Number(edit.fat_g) || 0, confidence: edit.confidence ?? "estimated", is_favourite: !!edit.is_favourite };
    const { error } = edit.id ? await supabase.from("saved_foods").update(row).eq("id", edit.id) : await supabase.from("saved_foods").insert(row);
    if (error) toast(errMsg(error), "err"); else { toast("Saved"); setEdit(null); reload(); }
  }

  return (
    <>
      <div className="flex justify-end mb-3"><Button variant="secondary" onClick={() => setEdit({ portion_label: "100 g", confidence: "estimated" })}><Plus className="size-4" />Add food</Button></div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : (
        <Card pad={false}>
          {data?.length ? data.map((f) => (
            <ListRow key={f.id} onClick={() => setEdit(f)} right={<button onClick={(e) => { e.stopPropagation(); setDel(f); }} className="size-9 grid place-items-center text-ink-3 hover:text-danger" aria-label="Delete"><Trash2 className="size-4" /></button>}>
              <div className="flex items-center gap-2"><span className="font-medium">{f.name}</span>{f.is_favourite && <Star className="size-3.5 text-accent" />}{f.confidence === "verified" ? <Badge tone="accent">Verified</Badge> : <Badge>Est.</Badge>}</div>
              <div className="text-xs text-ink-3 tabular">{f.portion_label} · {num(f.calories_kcal)} kcal · P {num(f.protein_g)} · C {num(f.carbs_g)} · F {num(f.fat_g)}</div>
            </ListRow>
          )) : <Empty title="Your food library is empty" body="Save foods you eat often for one-tap logging." />}
        </Card>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit food" : "Add food"}>
        {edit && (
          <form onSubmit={save} className="space-y-4">
            <Field label="Name"><Input required value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Portion" hint="e.g. 100 g, 1 katori, 2 rotis"><Input required value={edit.portion_label ?? ""} onChange={(e) => setEdit({ ...edit, portion_label: e.target.value })} /></Field>
            <div className="grid grid-cols-4 gap-2">
              {(["calories_kcal", "protein_g", "carbs_g", "fat_g"] as const).map((k) => (
                <Field key={k} label={k === "calories_kcal" ? "kcal" : k.replace("_g", " g").replace(/^\w/, (c) => c.toUpperCase())}>
                  <Input inputMode="decimal" value={edit[k] ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value as unknown as number })} />
                </Field>
              ))}
            </div>
            <Segmented value={edit.confidence ?? "estimated"} onChange={(v) => setEdit({ ...edit, confidence: v })} options={[{ value: "estimated", label: "Estimated" }, { value: "verified", label: "Verified" }]} />
            <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" className="size-5 accent-[#b5d86a]" checked={!!edit.is_favourite} onChange={(e) => setEdit({ ...edit, is_favourite: e.target.checked })} />Favourite</label>
            <Button size="lg" type="submit">Save</Button>
          </form>
        )}
      </Sheet>
      <Confirm open={!!del} title="Delete food?" body={del?.name} onClose={() => setDel(null)}
        onConfirm={async () => { const { error } = await supabase.from("saved_foods").delete().eq("id", del!.id); if (error) toast(errMsg(error), "err"); else reload(); }} />
    </>
  );
}
