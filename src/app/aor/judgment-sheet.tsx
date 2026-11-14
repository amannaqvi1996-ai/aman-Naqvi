"use client";
import { useEffect, useState } from "react";
import { Trash2, Plus, Check, BookOpen } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { fmtDay, fmtDateTime } from "@/lib/format";
import { Sheet, Field, Input, Select, Textarea, Button, Segmented, useToast, Badge, Confirm, cx } from "@/components/ui";
import { STATUSES, type Judgment, type Subject } from "./types";
import { briefFor, type Brief } from "./briefs";

const TEXT_FIELDS: { key: keyof Judgment; label: string }[] = [
  { key: "facts", label: "Facts" }, { key: "issues", label: "Issues" }, { key: "ratio_decidendi", label: "Ratio decidendi" },
  { key: "obiter_dicta", label: "Obiter dicta" }, { key: "important_paragraphs", label: "Important paragraphs" },
  { key: "statutory_provisions", label: "Relevant statutory provisions" }, { key: "personal_notes", label: "Personal notes" },
];

type Note = { id: string; body: string; paragraph_ref: string | null; created_at: string };
type Q = { id: string; question: string; answer: string | null; last_result: string | null; last_asked_at: string | null };

export function JudgmentSheet({ judgment, subjects, open, onClose, onSaved, onBrief }: { judgment: Partial<Judgment> | null; subjects: Subject[]; open: boolean; onClose: () => void; onSaved: () => void; onBrief?: (b: Brief) => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<"details" | "revise" | "notes">("details");
  const [j, setJ] = useState<Partial<Judgment>>({});
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const isNew = !judgment?.id;

  useEffect(() => { if (open) { setJ(judgment ?? {}); setTab(judgment?.id ? "revise" : "details"); } }, [open, judgment]);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!j.case_name?.trim()) return toast("Case name is required", "err");
    setBusy(true);
    const row = {
      case_name: j.case_name.trim(), citation: j.citation || null, court: j.court || null, year: j.year ? Number(j.year) : null,
      subject_id: j.subject_id || null, topic: j.topic || null, facts: j.facts || null, issues: j.issues || null,
      ratio_decidendi: j.ratio_decidendi || null, obiter_dicta: j.obiter_dicta || null, important_paragraphs: j.important_paragraphs || null,
      statutory_provisions: j.statutory_provisions || null, personal_notes: j.personal_notes || null,
      status: j.status ?? "not_started", confidence: j.confidence ? Number(j.confidence) : null, is_difficult: !!j.is_difficult,
      first_reading_date: j.first_reading_date || null,
    };
    const res = isNew ? await supabase.from("judgments").insert(row).select("*").single() : await supabase.from("judgments").update(row).eq("id", j.id!).select("*").single();
    setBusy(false);
    if (res.error) return toast(/duplicate|unique/i.test(res.error.message) ? "That judgment (same name and citation) already exists" : errMsg(res.error), "err");
    toast(isNew ? "Judgment added" : "Saved");
    setJ(res.data as Judgment);
    onSaved();
    if (isNew) onClose();
  }

  async function revise(quality: number, kind: "first_reading" | "revision" | "recall_test") {
    setBusy(true);
    const { data, error } = await supabase.rpc("record_revision", { p_judgment_id: j.id, p_quality: quality, p_kind: kind });
    setBusy(false);
    if (error) return toast(errMsg(error), "err");
    const nj = data as Judgment;
    setJ(nj);
    toast(`Next review ${nj.next_review_date ? fmtDay(nj.next_review_date, { weekday: "short", day: "numeric", month: "short" }) : "—"}`);
    onSaved();
  }

  const defaultKind: "first_reading" | "revision" | "recall_test" =
    !j.status || j.status === "not_started" || j.status === "reading" ? "first_reading" : j.status === "second_revision_completed" || j.status === "recall_test_completed" ? "recall_test" : "revision";
  const [kind, setKind] = useState(defaultKind);
  useEffect(() => setKind(defaultKind), [defaultKind]);

  return (
    <Sheet open={open} onClose={onClose} title={isNew ? "Add judgment" : (j.case_name ?? "Judgment")} wide>
      {!isNew && onBrief && (() => { const b = briefFor({ case_name: j.case_name ?? "", citation: j.citation ?? null }); return b ? (
        <Button variant="secondary" className="w-full mb-3" onClick={() => onBrief(b)}><BookOpen className="size-4" />Open master brief</Button>
      ) : null; })()}
      {!isNew && <div className="mb-4"><Segmented value={tab} onChange={setTab} options={[{ value: "revise", label: "Study" }, { value: "details", label: "Details" }, { value: "notes", label: "Notes & recall" }]} /></div>}

      {tab === "revise" && !isNew && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">{STATUSES.find((s) => s.value === j.status)?.label}</Badge>
            {j.is_difficult && <Badge tone="warn">Difficult</Badge>}
            {j.next_review_date && <Badge>Next review {fmtDay(j.next_review_date)}</Badge>}
            {j.citation && <Badge>{j.citation}</Badge>}
          </div>
          {j.ratio_decidendi ? (
            <details className="rounded-xl bg-surface-2 p-3"><summary className="cursor-pointer text-sm font-medium">Reveal ratio decidendi</summary><p className="mt-2 text-sm text-ink-2 whitespace-pre-wrap">{j.ratio_decidendi}</p></details>
          ) : <p className="text-sm text-ink-3">Add the ratio under Details to use reveal-style recall.</p>}
          <div>
            <div className="text-[13px] font-medium text-ink-2 mb-2">What did you just do?</div>
            <Segmented value={kind} onChange={setKind} options={[{ value: "first_reading", label: "First reading" }, { value: "revision", label: "Revision" }, { value: "recall_test", label: "Recall test" }]} />
          </div>
          <div>
            <div className="text-[13px] font-medium text-ink-2 mb-2">How well did you recall it?</div>
            <div className="grid grid-cols-4 gap-2">
              {[{ q: 1, l: "Forgot", c: "bg-danger/15 text-danger" }, { q: 3, l: "Hard", c: "bg-warn/15 text-warn" }, { q: 4, l: "Good", c: "bg-info/15 text-info" }, { q: 5, l: "Easy", c: "bg-accent/15 text-accent" }].map((b) => (
                <button key={b.q} disabled={busy} onClick={() => revise(b.q, kind)} className={cx("h-14 rounded-xl font-semibold text-sm disabled:opacity-50", b.c)}>{b.l}</button>
              ))}
            </div>
            <p className="text-xs text-ink-3 mt-2">Spaced repetition: “Forgot” resets the interval to 1 day and marks the case difficult; status only advances on a successful recall.</p>
          </div>
        </div>
      )}

      {tab === "details" && (
        <form onSubmit={save} className="space-y-4">
          <Field label="Case name"><Input required value={j.case_name ?? ""} onChange={(e) => setJ({ ...j, case_name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Citation" className="col-span-2"><Input value={j.citation ?? ""} onChange={(e) => setJ({ ...j, citation: e.target.value })} /></Field>
            <Field label="Court"><Input value={j.court ?? ""} onChange={(e) => setJ({ ...j, court: e.target.value })} /></Field>
            <Field label="Year"><Input inputMode="numeric" value={j.year ?? ""} onChange={(e) => setJ({ ...j, year: e.target.value as unknown as number })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Subject"><Select value={j.subject_id ?? ""} onChange={(e) => setJ({ ...j, subject_id: e.target.value || null })}><option value="">—</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Topic"><Input value={j.topic ?? ""} onChange={(e) => setJ({ ...j, topic: e.target.value })} /></Field>
            <Field label="Status"><Select value={j.status ?? "not_started"} onChange={(e) => setJ({ ...j, status: e.target.value as Judgment["status"] })}>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
            <Field label="Confidence (1–5)"><Select value={j.confidence ?? ""} onChange={(e) => setJ({ ...j, confidence: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
            <Field label="First reading date"><Input type="date" value={j.first_reading_date ?? ""} onChange={(e) => setJ({ ...j, first_reading_date: e.target.value || null })} /></Field>
            <label className="flex items-end gap-2 pb-3 text-sm text-ink-2"><input type="checkbox" className="size-5 accent-[#b5d86a]" checked={!!j.is_difficult} onChange={(e) => setJ({ ...j, is_difficult: e.target.checked })} />Difficult judgment</label>
          </div>
          {TEXT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}><Textarea value={(j[f.key] as string) ?? ""} onChange={(e) => setJ({ ...j, [f.key]: e.target.value })} /></Field>
          ))}
          <div className="flex gap-2">
            {!isNew && <Button type="button" variant="danger" onClick={() => setDel(true)}><Trash2 className="size-4" /></Button>}
            <Button type="submit" size="lg" loading={busy} className="flex-1">{isNew ? "Add judgment" : "Save changes"}</Button>
          </div>
        </form>
      )}

      {tab === "notes" && j.id && <NotesAndRecall judgmentId={j.id} />}

      <Confirm open={del} title="Delete judgment?" body="Its notes, revision history and recall questions will also be deleted." onClose={() => setDel(false)}
        onConfirm={async () => { const { error } = await supabase.from("judgments").delete().eq("id", j.id!); if (error) toast(errMsg(error), "err"); else { toast("Deleted"); onSaved(); onClose(); } }} />
    </Sheet>
  );
}

function NotesAndRecall({ judgmentId }: { judgmentId: string }) {
  const toast = useToast();
  const [notes, setNotes] = useState<Note[]>([]);
  const [qs, setQs] = useState<Q[]>([]);
  const [note, setNote] = useState({ body: "", paragraph_ref: "" });
  const [q, setQ] = useState({ question: "", answer: "" });
  const [shown, setShown] = useState<Record<string, boolean>>({});

  async function load() {
    const [n, r] = await Promise.all([
      supabase.from("judgment_notes").select("*").eq("judgment_id", judgmentId).order("created_at", { ascending: false }),
      supabase.from("recall_questions").select("*").eq("judgment_id", judgmentId).order("created_at"),
    ]);
    setNotes((n.data as Note[]) ?? []); setQs((r.data as Q[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [judgmentId]);

  async function addNote() {
    if (!note.body.trim()) return;
    const { error } = await supabase.from("judgment_notes").insert({ judgment_id: judgmentId, body: note.body.trim(), paragraph_ref: note.paragraph_ref || null });
    if (error) return toast(errMsg(error), "err");
    setNote({ body: "", paragraph_ref: "" }); load();
  }
  async function addQ() {
    if (!q.question.trim()) return;
    const { error } = await supabase.from("recall_questions").insert({ judgment_id: judgmentId, question: q.question.trim(), answer: q.answer || null });
    if (error) return toast(errMsg(error), "err");
    setQ({ question: "", answer: "" }); load();
  }
  async function mark(id: string, result: "correct" | "partial" | "incorrect") {
    const { error } = await supabase.from("recall_questions").update({ last_result: result, last_asked_at: new Date().toISOString() }).eq("id", id);
    if (error) toast(errMsg(error), "err"); else load();
  }

  return (
    <div className="space-y-6">
      <section>
        <h4 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3 mb-2">Active recall questions</h4>
        <div className="space-y-2">
          {qs.map((x) => (
            <div key={x.id} className="rounded-xl bg-surface-2 p-3">
              <div className="flex justify-between gap-2">
                <p className="font-medium text-sm">{x.question}</p>
                <button onClick={async () => { await supabase.from("recall_questions").delete().eq("id", x.id); load(); }} className="text-ink-3 hover:text-danger" aria-label="Delete question"><Trash2 className="size-4" /></button>
              </div>
              {x.answer && (shown[x.id] ? <p className="text-sm text-ink-2 mt-2 whitespace-pre-wrap">{x.answer}</p> : <button className="text-xs text-accent mt-2" onClick={() => setShown({ ...shown, [x.id]: true })}>Show answer</button>)}
              <div className="flex items-center gap-2 mt-2">
                {(["correct", "partial", "incorrect"] as const).map((r) => (
                  <button key={r} onClick={() => mark(x.id, r)} className={cx("h-8 px-2.5 rounded-lg text-xs font-medium", x.last_result === r ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink-2")}>{r}</button>
                ))}
                {x.last_asked_at && <span className="text-xs text-ink-3 ml-auto">{fmtDateTime(x.last_asked_at)}</span>}
              </div>
            </div>
          ))}
          <div className="rounded-xl border border-dashed border-line p-3 space-y-2">
            <Input placeholder="Question" value={q.question} onChange={(e) => setQ({ ...q, question: e.target.value })} />
            <Textarea placeholder="Answer (hidden until revealed)" className="min-h-16" value={q.answer} onChange={(e) => setQ({ ...q, answer: e.target.value })} />
            <Button size="sm" variant="secondary" onClick={addQ} disabled={!q.question.trim()}><Plus className="size-4" />Add question</Button>
          </div>
        </div>
      </section>
      <section>
        <h4 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3 mb-2">Notes</h4>
        <div className="rounded-xl border border-dashed border-line p-3 space-y-2 mb-3">
          <Textarea placeholder="Add a note on this judgment…" className="min-h-16" value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} />
          <div className="flex gap-2"><Input placeholder="Para ref (optional)" value={note.paragraph_ref} onChange={(e) => setNote({ ...note, paragraph_ref: e.target.value })} /><Button variant="secondary" onClick={addNote} disabled={!note.body.trim()}><Check className="size-4" />Add</Button></div>
        </div>
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-xl bg-surface-2 p-3 text-sm">
              <div className="flex justify-between text-xs text-ink-3 mb-1"><span>{fmtDateTime(n.created_at)}{n.paragraph_ref ? ` · para ${n.paragraph_ref}` : ""}</span>
                <button onClick={async () => { await supabase.from("judgment_notes").delete().eq("id", n.id); load(); }} className="hover:text-danger" aria-label="Delete note"><Trash2 className="size-3.5" /></button></div>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </div>
          ))}
          {!notes.length && <p className="text-sm text-ink-3">No notes yet.</p>}
        </div>
      </section>
    </div>
  );
}
