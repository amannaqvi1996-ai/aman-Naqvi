"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { dayKey, addDays, fmtDay, weekStart } from "@/lib/format";
import { Card, PageHeader, Spinner, ErrorBox, Button, Textarea, Field, Segmented, useToast, Input, Empty, ListRow, cx } from "@/components/ui";

type D = { id: string; entry_date: string; kind: "daily" | "weekly_reflection"; mood: number | null; body: string; wins: string | null; improvements: string | null; version: number; updated_at: string };
const MOODS = ["😞", "😕", "😐", "🙂", "😄"];

export default function DiaryPage() {
  const [mode, setMode] = useState<"daily" | "weekly_reflection" | "search">("daily");
  const [day, setDay] = useState(dayKey());
  const date = mode === "weekly_reflection" ? weekStart(day) : day;

  return (
    <>
      <PageHeader title="Diary" subtitle="Daily journal and weekly reflections" />
      <div className="mb-4"><Segmented value={mode} onChange={setMode} options={[{ value: "daily", label: "Daily" }, { value: "weekly_reflection", label: "Weekly review" }, { value: "search", label: "Search" }]} /></div>
      {mode === "search" ? <DiarySearch onOpen={(d, k) => { setDay(d); setMode(k); }} /> : (
        <>
          <div className="flex items-center justify-between mb-3">
            <button className="size-10 grid place-items-center rounded-full bg-surface-2" onClick={() => setDay(addDays(day, mode === "daily" ? -1 : -7))} aria-label="Previous"><ChevronLeft className="size-5" /></button>
            <div className="text-center font-semibold">{mode === "daily" ? (day === dayKey() ? "Today" : fmtDay(day, { weekday: "long", day: "numeric", month: "long" })) : `Week of ${fmtDay(date, { day: "numeric", month: "long" })}`}</div>
            <button className="size-10 grid place-items-center rounded-full bg-surface-2 disabled:opacity-30" disabled={addDays(day, mode === "daily" ? 1 : 7) > dayKey() && mode === "daily"} onClick={() => setDay(addDays(day, mode === "daily" ? 1 : 7))} aria-label="Next"><ChevronRight className="size-5" /></button>
          </div>
          <Editor key={`${mode}-${date}`} date={date} kind={mode} />
        </>
      )}
    </>
  );
}

function Editor({ date, kind }: { date: string; kind: "daily" | "weekly_reflection" }) {
  const toast = useToast();
  const [form, setForm] = useState({ body: "", wins: "", improvements: "", mood: null as number | null });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const loadedVersion = useRef<number | null>(null);
  const { data, error, loading, reload } = useLive(async () => (await must(supabase.from("diary_entries").select("*").eq("entry_date", date).eq("kind", kind).maybeSingle())) as D | null, ["diary_entries"], [date, kind]);

  useEffect(() => {
    if (loading) return;
    if (dirty && data && loadedVersion.current != null && data.version !== loadedVersion.current) { setConflict(true); return; }
    if (!dirty) {
      setForm({ body: data?.body ?? "", wins: data?.wins ?? "", improvements: data?.improvements ?? "", mood: data?.mood ?? null });
      loadedVersion.current = data?.version ?? null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading]);

  function upd(p: Partial<typeof form>) { setForm((f) => ({ ...f, ...p })); setDirty(true); }

  async function save() {
    setBusy(true);
    try {
      const row = { body: form.body, wins: form.wins || null, improvements: form.improvements || null, mood: form.mood };
      if (data) {
        const { error } = await supabase.from("diary_entries").update({ ...row, version: loadedVersion.current ?? data.version }).eq("id", data.id);
        if (error) { if ((error as { code?: string }).code === "40001" || /another device/.test(error.message)) { setConflict(true); return; } throw error; }
      } else {
        const { error } = await supabase.from("diary_entries").insert({ ...row, entry_date: date, kind });
        if (error) throw error;
      }
      setDirty(false); setConflict(false); toast("Saved"); await reload();
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  }

  if (loading && !data) return <Spinner />;
  return (
    <div className="grid gap-3 lg:grid-cols-3 lg:gap-4">
      {error && <ErrorBox error={error} onRetry={reload} />}
      {conflict && (
        <div className="lg:col-span-3 rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn flex flex-wrap items-center gap-3">
          This entry was changed on another device.
          <Button size="sm" variant="secondary" onClick={() => { setDirty(false); setConflict(false); loadedVersion.current = data?.version ?? null; setForm({ body: data?.body ?? "", wins: data?.wins ?? "", improvements: data?.improvements ?? "", mood: data?.mood ?? null }); }}>Load their version</Button>
          <Button size="sm" onClick={() => { loadedVersion.current = data?.version ?? null; setConflict(false); save(); }}>Keep mine</Button>
        </div>
      )}
      <Card className="lg:col-span-2">
        <div className="mb-3">
          <div className="text-[13px] font-medium text-ink-2 mb-2">Mood</div>
          <div className="flex gap-2">{MOODS.map((m, i) => (
            <button key={i} type="button" onClick={() => upd({ mood: form.mood === i + 1 ? null : i + 1 })} className={cx("size-11 rounded-xl text-xl", form.mood === i + 1 ? "bg-accent/20 ring-2 ring-accent" : "bg-surface-2")} aria-label={`Mood ${i + 1}`}>{m}</button>
          ))}</div>
        </div>
        <Field label={kind === "daily" ? "Journal" : "Reflection"}>
          <Textarea className="min-h-64" value={form.body} onChange={(e) => upd({ body: e.target.value })} placeholder={kind === "daily" ? "How did today go?" : "How did this week go across AOR, practice and training?"} />
        </Field>
      </Card>
      <Card>
        <div className="space-y-4">
          <Field label="Wins"><Textarea value={form.wins} onChange={(e) => upd({ wins: e.target.value })} /></Field>
          <Field label={kind === "daily" ? "To improve" : "Focus for next week"}><Textarea value={form.improvements} onChange={(e) => upd({ improvements: e.target.value })} /></Field>
          <Button size="lg" onClick={save} loading={busy} disabled={!dirty}>{dirty ? "Save entry" : "Saved"}</Button>
          {data && <p className="text-xs text-ink-3 text-center">Last saved {new Date(data.updated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</p>}
        </div>
      </Card>
    </div>
  );
}

function DiarySearch({ onOpen }: { onOpen: (d: string, k: "daily" | "weekly_reflection") => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const { data, loading, error } = useLive(async () => {
    let qb = supabase.from("diary_entries").select("id, entry_date, kind, body, mood").order("entry_date", { ascending: false }).limit(50);
    if (term) qb = qb.textSearch("search", term, { type: "websearch", config: "english" });
    return (await must(qb)) as Pick<D, "id" | "entry_date" | "kind" | "body" | "mood">[];
  }, ["diary_entries"], [term]);
  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }} className="flex gap-2 mb-3">
        <Input placeholder="Search your diary…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="secondary"><Search className="size-4" /></Button>
      </form>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Spinner /> : (
        <Card pad={false}>
          {data?.length ? data.map((d) => (
            <ListRow key={d.id} onClick={() => onOpen(d.entry_date, d.kind)}>
              <div className="flex justify-between"><span className="font-medium">{d.kind === "daily" ? fmtDay(d.entry_date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : `Week of ${fmtDay(d.entry_date)}`}</span><span>{d.mood ? MOODS[d.mood - 1] : ""}</span></div>
              <div className="text-sm text-ink-3 line-clamp-2">{d.body || "—"}</div>
            </ListRow>
          )) : <Empty title={term ? "No matches" : "No entries yet"} />}
        </Card>
      )}
    </>
  );
}
