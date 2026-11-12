"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Star, Sparkles } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { toLocalInput, fromLocalInput } from "@/lib/format";
import { Button, Field, Input, Select, Sheet, Segmented, useToast, cx } from "@/components/ui";

export type Entry = {
  id: string; consumed_at: string; meal: Meal; food_name: string; portion: string;
  calories_kcal: number; protein_g: number; carbs_g: number; fat_g: number; confidence: "estimated" | "verified"; notes: string | null;
};
export type Food = { id: string; name: string; portion_label: string; calories_kcal: number; protein_g: number; carbs_g: number; fat_g: number; confidence: "estimated" | "verified"; is_favourite: boolean };
export type Meal = "breakfast" | "lunch" | "evening_snack" | "dinner" | "other";
export const MEALS: { value: Meal; label: string }[] = [
  { value: "breakfast", label: "Breakfast" }, { value: "lunch", label: "Lunch" },
  { value: "evening_snack", label: "Evening snack" }, { value: "dinner", label: "Dinner" }, { value: "other", label: "Other" },
];

function defaultMeal(): Meal {
  const h = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()));
  return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 19 ? "evening_snack" : "dinner";
}

export function FoodSheet({ open, onClose, onSaved, entry, defaultDate }: { open: boolean; onClose: () => void; onSaved: () => void; entry?: Entry | null; defaultDate?: string }) {
  const toast = useToast();
  const [foods, setFoods] = useState<Food[]>([]);
  const [q, setQ] = useState("");
  const [f, setF] = useState({ meal: defaultMeal() as Meal, food_name: "", portion: "1 serving", calories_kcal: "", protein_g: "", carbs_g: "", fat_g: "", confidence: "estimated" as "estimated" | "verified", when: toLocalInput(), saveToLibrary: false, mult: "1" });
  const [base, setBase] = useState<Food | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiBreakdown, setAiBreakdown] = useState<{ items: { name: string; portion: string; calories_kcal: number; protein_g: number; carbs_g: number; fat_g: number }[]; notes: string[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from("saved_foods").select("*").order("is_favourite", { ascending: false }).order("name").then(({ data }) => setFoods((data as Food[]) ?? []));
    if (entry) {
      setF({ meal: entry.meal, food_name: entry.food_name, portion: entry.portion, calories_kcal: String(entry.calories_kcal), protein_g: String(entry.protein_g), carbs_g: String(entry.carbs_g), fat_g: String(entry.fat_g), confidence: entry.confidence, when: toLocalInput(entry.consumed_at), saveToLibrary: false, mult: "1" });
    } else {
      const when = defaultDate ? `${defaultDate}T${toLocalInput().slice(11)}` : toLocalInput();
      setF((x) => ({ ...x, meal: defaultMeal(), food_name: "", portion: "1 serving", calories_kcal: "", protein_g: "", carbs_g: "", fat_g: "", confidence: "estimated", when, saveToLibrary: false, mult: "1" }));
    }
    setBase(null); setQ(""); setAiText(""); setAiBreakdown(null);
  }, [open, entry, defaultDate]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? foods.filter((x) => x.name.toLowerCase().includes(s)) : foods).slice(0, 8);
  }, [q, foods]);

  function pick(food: Food) {
    setBase(food);
    setF((x) => ({ ...x, food_name: food.name, portion: food.portion_label, calories_kcal: String(food.calories_kcal), protein_g: String(food.protein_g), carbs_g: String(food.carbs_g), fat_g: String(food.fat_g), confidence: food.confidence, mult: "1" }));
  }
  function setMult(m: string) {
    setF((x) => {
      const k = Number(m);
      if (!base || !(k > 0)) return { ...x, mult: m };
      const r = (v: number) => String(Math.round(v * k * 10) / 10);
      return { ...x, mult: m, portion: k === 1 ? base.portion_label : `${k} × ${base.portion_label}`, calories_kcal: r(base.calories_kcal), protein_g: r(base.protein_g), carbs_g: r(base.carbs_g), fat_g: r(base.fat_g) };
    });
  }

  async function analyzeFood() {
    const description = aiText.trim();
    if (!description) return toast("Describe the food and quantities first", "err");
    setAiBusy(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Please sign in again before using AI nutrition.");
      const response = await fetch("/api/nutrition/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not analyse this meal.");
      setF((x) => ({ ...x, food_name: result.food_name, portion: result.portion, calories_kcal: String(result.totals.calories_kcal), protein_g: String(result.totals.protein_g), carbs_g: String(result.totals.carbs_g), fat_g: String(result.totals.fat_g), confidence: "estimated" }));
      setBase(null);
      setAiBreakdown({ items: result.items, notes: result.notes ?? [] });
      toast("Nutrition estimate ready — review it before logging.");
    } catch (err) { toast(errMsg(err), "err"); } finally { setAiBusy(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const kcal = Number(f.calories_kcal);
    if (!f.food_name.trim()) return toast("Enter a food name", "err");
    if (!(kcal >= 0) || f.calories_kcal === "") return toast("Enter calories", "err");
    setBusy(true);
    try {
      const row = {
        meal: f.meal, food_name: f.food_name.trim(), portion: f.portion.trim() || "1 serving",
        calories_kcal: kcal, protein_g: Number(f.protein_g) || 0, carbs_g: Number(f.carbs_g) || 0, fat_g: Number(f.fat_g) || 0,
        confidence: f.confidence, consumed_at: fromLocalInput(f.when), saved_food_id: base?.id ?? null,
      };
      const { error } = entry ? await supabase.from("nutrition_entries").update(row).eq("id", entry.id) : await supabase.from("nutrition_entries").insert(row);
      if (error) throw error;
      if (f.saveToLibrary && !base) {
        await supabase.from("saved_foods").insert({ name: row.food_name, portion_label: row.portion, calories_kcal: row.calories_kcal, protein_g: row.protein_g, carbs_g: row.carbs_g, fat_g: row.fat_g, confidence: row.confidence, source: "own entry" });
      }
      toast(entry ? "Entry updated" : `Logged ${row.food_name}`);
      onSaved(); onClose();
    } catch (err) { toast(errMsg(err), "err"); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title={entry ? "Edit entry" : "Log food"}>
      <form onSubmit={save} className="space-y-4">
        {!entry && foods.length > 0 && (
          <div>
            <Input placeholder="Search your food library…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex gap-2 overflow-x-auto scrollbar-none mt-2 pb-1">
              {matches.map((m) => (
                <button type="button" key={m.id} onClick={() => pick(m)} className={cx("shrink-0 px-3 h-9 rounded-full text-sm border", base?.id === m.id ? "bg-accent text-accent-ink border-accent" : "bg-surface-2 border-line text-ink-2")}>
                  {m.is_favourite && <Star className="inline size-3 mr-1 -mt-0.5" />}{m.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {!entry && <div className="rounded-xl border border-accent/30 bg-surface-2 p-3 space-y-3">
          <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-accent" />AI meal analysis</div>
          <p className="text-xs text-ink-3">Describe everything you ate, including quantities and cooking method. Example: 2 homemade rotis, 150 g chicken shami kebab, 100 g cooked rice.</p>
          <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={3} maxLength={1200} placeholder="Describe your meal in ordinary language…" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
          <Button type="button" variant="secondary" onClick={analyzeFood} loading={aiBusy}><Sparkles className="size-4" />Analyse meal</Button>
          {aiBreakdown && <div className="rounded-lg bg-surface p-3 space-y-2">
            <div className="text-sm font-semibold">AI estimate by item</div>
            {aiBreakdown.items.map((item, index) => <div key={`${item.name}-${index}`} className="flex justify-between gap-3 text-xs"><span className="text-ink-2">{item.name} <span className="text-ink-3">· {item.portion}</span></span><span className="shrink-0 tabular">{Math.round(item.calories_kcal)} kcal</span></div>)}
            {aiBreakdown.notes.map((note, index) => <p key={index} className="text-xs text-ink-3">{note}</p>)}
            <p className="text-xs text-ink-3">Check the totals below and adjust them if needed before logging. AI values are estimates, not laboratory measurements.</p>
          </div>}
        </div>}
        <Segmented value={f.meal} onChange={(v) => setF({ ...f, meal: v })} options={MEALS.map((m) => ({ value: m.value, label: m.label }))} />
        <Field label="Food"><Input required value={f.food_name} onChange={(e) => { setF({ ...f, food_name: e.target.value }); setBase(null); }} placeholder="e.g. Paneer bhurji" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Portion"><Input value={f.portion} onChange={(e) => setF({ ...f, portion: e.target.value })} /></Field>
          {base ? <Field label="Servings"><Input inputMode="decimal" value={f.mult} onChange={(e) => setMult(e.target.value)} /></Field>
                : <Field label="When"><Input type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></Field>}
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Field label="kcal"><Input inputMode="decimal" required value={f.calories_kcal} onChange={(e) => setF({ ...f, calories_kcal: e.target.value })} /></Field>
          <Field label="Protein g"><Input inputMode="decimal" value={f.protein_g} onChange={(e) => setF({ ...f, protein_g: e.target.value })} /></Field>
          <Field label="Carbs g"><Input inputMode="decimal" value={f.carbs_g} onChange={(e) => setF({ ...f, carbs_g: e.target.value })} /></Field>
          <Field label="Fat g"><Input inputMode="decimal" value={f.fat_g} onChange={(e) => setF({ ...f, fat_g: e.target.value })} /></Field>
        </div>
        {base && <Field label="When"><Input type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></Field>}
        <div className="flex items-center justify-between gap-3">
          <Segmented value={f.confidence} onChange={(v) => setF({ ...f, confidence: v })} options={[{ value: "estimated", label: "Estimated" }, { value: "verified", label: "Verified (label)" }]} />
        </div>
        {!entry && !base && (
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" className="size-5 accent-[#b5d86a]" checked={f.saveToLibrary} onChange={(e) => setF({ ...f, saveToLibrary: e.target.checked })} />Save to my food library</label>
        )}
        <Button size="lg" type="submit" loading={busy}>{entry ? "Save changes" : "Log food"}</Button>
      </form>
    </Sheet>
  );
}

export function QuickFoodButton({ onSaved, className }: { onSaved: () => void; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className={className} onClick={() => setOpen(true)}><Plus className="size-4" />Log food</Button>
      <FoodSheet open={open} onClose={() => setOpen(false)} onSaved={onSaved} />
    </>
  );
}
