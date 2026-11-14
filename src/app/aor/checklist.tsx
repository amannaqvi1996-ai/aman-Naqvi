"use client";
import { useMemo, useState } from "react";
import { Check, Search, ListPlus, BookOpen } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { dayKey, addDays } from "@/lib/format";
import { Card, Button, Input, Select, Textarea, Sheet, Empty, useToast, cx } from "@/components/ui";
import { LEADING_CASES } from "./leading-cases";
import { briefFor, type Brief } from "./briefs";
import { statusIdx, type JStatus, type Judgment, type Subject } from "./types";

// Each tick maps onto the judgment's existing status, so Today, revision and stats stay in sync.
const STEPS: { label: string; short: string; done: JStatus; idx: number }[] = [
  { label: "One-time read", short: "Read", done: "first_reading_completed", idx: statusIdx("first_reading_completed") },
  { label: "Revision 1", short: "Rev 1", done: "first_revision_completed", idx: statusIdx("first_revision_completed") },
  { label: "Revision 2", short: "Rev 2", done: "second_revision_completed", idx: statusIdx("second_revision_completed") },
];
const BEFORE: JStatus[] = ["not_started", "first_reading_completed", "first_revision_completed"];

export function Checklist({ subjects, judgments, reload, onBrief }: { subjects: Subject[]; judgments: Judgment[]; reload: () => void; onBrief?: (b: Brief) => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState("");
  const [show, setShow] = useState<"all" | "pending" | "done">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const order = useMemo(() => new Map(LEADING_CASES.map((c) => [c.citation.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), c.no])), []);
  const noOf = (j: Judgment) => order.get((j.citation ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()) ?? 999;
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return judgments.slice().sort((a, b) => noOf(a) - noOf(b) || a.case_name.localeCompare(b.case_name)).filter((j) =>
      (!s || [j.case_name, j.citation, j.topic].some((v) => v?.toLowerCase().includes(s))) &&
      (!subject || (subject === "none" ? !j.subject_id : j.subject_id === subject)) &&
      (show === "all" || (show === "done" ? statusIdx(j.status) >= STEPS[2].idx : statusIdx(j.status) < STEPS[2].idx)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [judgments, q, subject, show]);

  const [loading, setLoading] = useState(false);
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const have = new Set(judgments.map((j) => norm(j.citation || j.case_name)));
  const missing = LEADING_CASES.filter((c) => !have.has(norm(c.citation)) && !judgments.some((j) => norm(j.case_name) === norm(c.case_name)));
  async function loadLeading() {
    if (!missing.length) return;
    setLoading(true);
    const rows = missing.map((c) => ({ case_name: c.case_name, citation: c.citation, year: Number(c.citation.match(/\d{4}/)?.[0]) || null, court: "Supreme Court of India", status: "not_started" }));
    const { error } = await supabase.from("judgments").insert(rows);
    setLoading(false);
    if (error) toast(errMsg(error), "err"); else { toast(`Added ${rows.length} leading cases`); reload(); }
  }

  const counts = STEPS.map((st) => judgments.filter((j) => statusIdx(j.status) >= st.idx).length);

  async function tick(j: Judgment, step: number) {
    const checked = statusIdx(j.status) >= STEPS[step].idx;
    // Ticking a later box also completes the earlier ones; unticking returns to the step before it.
    const status: JStatus = checked ? BEFORE[step] : STEPS[step].done;
    const row: Record<string, unknown> = { status };
    // Keep the revision calendar in step: Read → Rev 1 in 7 days, Rev 1 → Rev 2 in 21 days.
    const reached = statusIdx(status);
    if (reached < STEPS[0].idx) row.next_review_date = null;
    else if (reached === STEPS[0].idx) row.next_review_date = addDays(dayKey(), 7);
    else if (reached === STEPS[1].idx) row.next_review_date = addDays(dayKey(), 21);
    else if (reached >= STEPS[2].idx) row.next_review_date = null;
    if (!checked && !j.first_reading_date) row.first_reading_date = dayKey();
    setBusy(`${j.id}:${step}`);
    const { error } = await supabase.from("judgments").update(row).eq("id", j.id);
    setBusy(null);
    if (error) toast(errMsg(error), "err"); else reload();
  }

  return (
    <>
      {missing.length > 0 && (
        <Card className="mb-3"><div className="flex flex-wrap items-center gap-3 justify-between"><div className="text-sm"><b>List of Leading Cases</b><div className="text-ink-3 text-xs">{missing.length} of {LEADING_CASES.length} cases not in your list yet</div></div><Button disabled={loading} onClick={loadLeading}>{loading ? "Adding…" : `Add ${missing.length} cases`}</Button></div></Card>
      )}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {STEPS.map((st, i) => (
          <Card key={st.label}><div className="text-xs text-ink-3">{st.label}</div><div className="text-lg font-semibold tabular">{counts[i]}<span className="text-ink-3 text-sm font-normal">/{judgments.length}</span></div></Card>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <div className="relative col-span-2 lg:col-span-1"><Search className="size-4 absolute left-3 top-3.5 text-ink-3" /><Input className="pl-9" placeholder="Search judgments" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">All subjects</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="none">No subject</option></Select>
        <Select value={show} onChange={(e) => setShow(e.target.value as typeof show)}><option value="all">All</option><option value="pending">Not finished</option><option value="done">All 3 done</option></Select>
        <Button variant="secondary" onClick={() => setAdding(true)}><ListPlus className="size-4" />Add list</Button>
      </div>

      {!judgments.length ? <Card><Empty title="No judgments yet" body="Tap “Add list” and paste your judgments, one per line." action={<Button onClick={() => setAdding(true)}>Add list</Button>} /></Card> : (
        <Card pad={false}>
          <div className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-wider text-ink-3 border-b border-line-soft">
            <span className="flex-1">Judgment</span><span className="w-8 text-center">Brief</span>
            {STEPS.map((st) => <span key={st.short} className="w-12 text-center">{st.short}</span>)}
          </div>
          {list.length ? list.map((j) => {
            const idx = statusIdx(j.status);
            return (
              <div key={j.id} className="flex items-center gap-2 px-4 py-2.5 min-h-[56px] border-t border-line-soft first:border-t-0">
                <div className="flex-1 min-w-0">
                  <div className={cx("font-medium text-sm leading-snug", idx >= STEPS[2].idx && "text-ink-3")}>{noOf(j) < 999 && <span className="text-ink-3 tabular mr-1.5">{noOf(j)}.</span>}{j.case_name}</div>
                  {j.citation && <div className="text-xs text-ink-3 truncate">{j.citation}</div>}
                </div>
                {(() => { const b = onBrief && briefFor(j); return b ? <button onClick={() => onBrief!(b)} aria-label={`Open master brief: ${j.case_name}`} title="Open master brief" className="size-8 grid place-items-center rounded-lg text-accent hover:bg-surface-2 shrink-0"><BookOpen className="size-4" /></button> : <span className="size-8 shrink-0" />; })()}
                {STEPS.map((st, i) => {
                  const on = idx >= st.idx;
                  return (
                    <div key={st.short} className="w-12 grid place-items-center">
                      <button onClick={() => tick(j, i)} disabled={busy != null} aria-label={`${st.label}: ${on ? "done" : "not done"}`} title={st.label}
                        className={cx("size-7 rounded-md border-2 grid place-items-center transition", on ? "bg-accent border-accent text-accent-ink" : "border-line hover:border-accent", busy === `${j.id}:${i}` && "opacity-50")}>
                        {on && <Check className="size-4" strokeWidth={3} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          }) : <Empty title="No judgments match" />}
        </Card>
      )}
      <p className="text-xs text-ink-3 mt-2">Ticking Revision 1 or 2 also ticks the boxes before it. The ticks update each judgment&apos;s status, so your Today plan and revision calendar stay in step.</p>
      <BulkAdd open={adding} onClose={() => setAdding(false)} subjects={subjects} judgments={judgments} onDone={reload} />
    </>
  );
}

function BulkAdd({ open, onClose, subjects, judgments, onDone }: { open: boolean; onClose: () => void; subjects: Subject[]; judgments: Judgment[]; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const existing = useMemo(() => new Set(judgments.map((j) => norm(j.case_name))), [judgments]);
  const lines = text.split("\n").map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim()).filter(Boolean);
  const fresh = lines.filter((l, i) => !existing.has(norm(l)) && lines.findIndex((x) => norm(x) === norm(l)) === i);

  async function save() {
    if (!fresh.length) return;
    setBusy(true);
    const rows = fresh.map((case_name) => ({ case_name, subject_id: subject || null, status: "not_started" }));
    let n = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from("judgments").insert(rows.slice(i, i + 200));
      if (error) { setBusy(false); toast(errMsg(error), "err"); return; }
      n += Math.min(200, rows.length - i);
    }
    setBusy(false); toast(`Added ${n} judgments`); setText(""); onDone(); onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add judgments">
      <div className="space-y-3">
        <p className="text-sm text-ink-2">Paste one judgment per line. Numbering and bullets are removed automatically, and cases already in your list are skipped.</p>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-48" placeholder={"Kesavananda Bharati v. State of Kerala\nManeka Gandhi v. Union of India\n…"} />
        <Select value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">No subject</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <p className="text-xs text-ink-3">{lines.length ? `${fresh.length} new · ${lines.length - fresh.length} already in list or repeated` : ""}</p>
        <Button size="lg" className="w-full" disabled={busy || !fresh.length} onClick={save}>{busy ? "Adding…" : `Add ${fresh.length || ""} judgments`}</Button>
      </div>
    </Sheet>
  );
}
