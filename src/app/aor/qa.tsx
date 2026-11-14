"use client";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Eye, PenLine, Timer, Check, ChevronRight } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { Card, Button, Badge, Spinner, ErrorBox, Segmented, Input, Field, useToast, cx } from "@/components/ui";
import { LEADING_CASES } from "./leading-cases";

// Q&A sets (questions + model answers), served from /public/qa. Keyed by the case's number in the List of Leading Cases.
export const QA_SETS: Record<number, string> = {
  2: "02-maneka-gandhi.json",
};
export function qaFor(caseNo: number | null | undefined) { return caseNo && QA_SETS[caseNo] ? caseNo : null; }

type Question = { id: string; marks: number; question: string; minutes: number; skeleton: string[]; examiner: string[]; answer: string; confidence: "green" | "yellow" | "red" };
type QaSet = { no: number; case_name: string; citation: string; note?: string; questions: Question[] };
type Attempt = { id: string; question_id: string; marks: number; score: number | null; minutes_taken: number | null; illegible_words: number | null; created_at: string };

const wordCount = (s: string) => s.replace(/[#*\-🟢🟡🔴]/g, " ").split(/\s+/).filter(Boolean).length;

/** Renders the light markup used in model answers: "## " headings, "- " bullets, "1. " numbered points, **bold**, *italic*. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean).map((t, i) =>
    t.startsWith("**") ? <strong key={i} className="font-semibold text-ink">{t.slice(2, -2)}</strong> : t.startsWith("*") ? <em key={i}>{t.slice(1, -1)}</em> : <Fragment key={i}>{t}</Fragment>);
}
function Answer({ text }: { text: string }) {
  const out: ReactNode[] = []; let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => { if (!list) return; const L = list; out.push(L.kind === "ul"
    ? <ul key={out.length} className="list-disc pl-5 space-y-1">{L.items.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>
    : <ol key={out.length} className="list-decimal pl-5 space-y-1">{L.items.map((x, i) => <li key={i}>{inline(x)}</li>)}</ol>); list = null; };
  text.split("\n").forEach((line) => {
    const l = line.trim(); if (!l) return;
    const b = l.match(/^- (.*)/), n = l.match(/^\d+\. (.*)/);
    if (b) { if (list?.kind !== "ul") { flush(); list = { kind: "ul", items: [] }; } list!.items.push(b[1]); return; }
    if (n) { if (list?.kind !== "ol") { flush(); list = { kind: "ol", items: [] }; } list!.items.push(n[1]); return; }
    flush();
    if (l.startsWith("## ")) out.push(<h4 key={out.length} className="text-[13px] font-semibold uppercase tracking-wider text-accent mt-4 first:mt-0">{l.slice(3)}</h4>);
    else out.push(<p key={out.length}>{inline(l)}</p>);
  });
  flush();
  return <div className="space-y-2 text-[15.5px] leading-relaxed text-ink-2">{out}</div>;
}

export function CaseQA({ caseNo, onClose }: { caseNo: number | null; onClose: () => void }) {
  const [set, setSet] = useState<QaSet | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"read" | "attempt">("read");
  const [qi, setQi] = useState<number | null>(null);

  useEffect(() => {
    if (!caseNo || !QA_SETS[caseNo]) return;
    let live = true;
    fetch(`/qa/${QA_SETS[caseNo]}`).then((r) => { if (!r.ok) throw new Error(`Couldn't load the Q&A set (${r.status})`); return r.json(); })
      .then((d: QaSet) => { if (live) { setSet(d); setErr(null); } }).catch((e) => live && setErr(errMsg(e)));
    return () => { live = false; };
  }, [caseNo]);
  useEffect(() => {
    if (!caseNo) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { if (qi != null) setQi(null); else onClose(); } };
    window.addEventListener("keydown", k);
    const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = o; };
  }, [caseNo, onClose, qi]);

  const attempts = useLive(async () => {
    if (!caseNo) return [] as Attempt[];
    return (await must(supabase.from("answer_attempts").select("id, question_id, marks, score, minutes_taken, illegible_words, created_at").eq("case_no", caseNo).order("created_at", { ascending: false }).limit(500))) as Attempt[];
  }, ["answer_attempts"], [caseNo]);

  if (!caseNo) return null;
  const name = set?.case_name ?? LEADING_CASES.find((c) => c.no === caseNo)?.case_name ?? "";
  const q = qi != null ? set?.questions[qi] : null;
  const last = (id: string) => attempts.data?.find((a) => a.question_id === id);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg anim-fade" role="dialog" aria-modal="true" aria-label={`Questions and model answers: ${name}`}>
      <div className="flex items-center gap-2 px-2 pt-[calc(env(safe-area-inset-top)+6px)] pb-2 border-b border-line-soft bg-surface">
        <button onClick={() => (q ? setQi(null) : onClose())} className="h-10 px-2 rounded-lg flex items-center gap-1 text-ink-2 hover:bg-surface-2 shrink-0" aria-label="Back"><ArrowLeft className="size-5" /><span className="text-sm font-medium">Back</span></button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-sm font-semibold truncate">{name}</div>
          <div className="text-[11px] text-ink-3 truncate">{q ? `${q.marks} marks · ${q.minutes} min` : "Questions & model answers"}</div>
        </div>
        <span className="w-[72px] shrink-0" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 safe-bottom">
        <div className="max-w-2xl mx-auto">
          {err ? <ErrorBox error={err} /> : !set ? <Spinner /> : q ? (
            <QuestionView key={`${q.id}-${mode}`} q={q} caseNo={caseNo} mode={mode} attemptsError={attempts.error}
              onNext={qi! < set.questions.length - 1 ? () => setQi(qi! + 1) : undefined} onSaved={attempts.reload} />
          ) : (
            <>
              <div className="mb-3"><Segmented value={mode} onChange={setMode} options={[{ value: "read", label: "Read" }, { value: "attempt", label: "Attempt first" }]} /></div>
              <p className="text-xs text-ink-3 mb-3">{mode === "read" ? "Read the model answers to learn the structure for each mark range." : "Write your answer by hand against the timer, then reveal the model answer and mark yourself."}</p>
              <Card pad={false}>
                {set.questions.map((x, i) => {
                  const a = last(x.id);
                  return (
                    <button key={x.id} onClick={() => setQi(i)} className="w-full text-left flex items-center gap-3 px-4 py-3 min-h-[64px] border-t border-line-soft first:border-t-0 hover:bg-surface-2 active:bg-surface-2">
                      <Badge tone={x.marks >= 15 ? "warn" : x.marks >= 10 ? "info" : x.marks >= 5 ? "accent" : "neutral"}>{x.marks} m</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium leading-snug line-clamp-2">{x.question}</div>
                        <div className="text-xs text-ink-3 mt-0.5">{x.minutes} min{a?.score != null ? ` · last score ${a.score}/${x.marks}` : ""}</div>
                      </div>
                      <ChevronRight className="size-4 text-ink-3 shrink-0" />
                    </button>
                  );
                })}
              </Card>
              {set.note && <p className="text-xs text-ink-3 mt-3">{set.note}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionView({ q, caseNo, mode, onNext, onSaved, attemptsError }: { q: Question; caseNo: number; mode: "read" | "attempt"; onNext?: () => void; onSaved: () => void; attemptsError: string | null }) {
  const toast = useToast();
  const [revealed, setRevealed] = useState(mode === "read");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [score, setScore] = useState("");
  const [illegible, setIllegible] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (startedAt == null || revealed) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [startedAt, revealed]);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const left = q.minutes * 60 - elapsed;
  const fmt = (s: number) => `${s < 0 ? "−" : ""}${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, "0")}`;

  async function save() {
    const sc = score === "" ? null : Number(score);
    if (sc != null && (isNaN(sc) || sc < 0 || sc > q.marks)) { toast(`Score must be between 0 and ${q.marks}`, "err"); return; }
    setBusy(true);
    const { error } = await supabase.from("answer_attempts").insert({
      case_no: caseNo, question_id: q.id, marks: q.marks, score: sc,
      minutes_taken: startedAt ? Math.round((elapsed / 60) * 10) / 10 : null, illegible_words: illegible === "" ? null : Number(illegible),
    });
    setBusy(false);
    if (error) toast(/answer_attempts/.test(error.message) ? "Run the answer-practice SQL in Supabase first" : errMsg(error), "err");
    else { setSaved(true); toast("Attempt saved"); onSaved(); }
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-2 mb-2"><Badge tone="accent">{q.marks} marks</Badge><span className="text-xs text-ink-3">{q.minutes} min · model ≈ {wordCount(q.answer)} words</span></div>
        <p className="text-[18px] font-semibold leading-snug">{q.question}</p>
      </Card>

      {mode === "attempt" && !revealed && (
        <Card>
          {startedAt == null ? (
            <>
              <p className="text-sm text-ink-2 mb-3">Take paper and pen. Write your full answer by hand, then reveal the model answer.</p>
              <Button size="lg" onClick={() => { const t = Date.now(); setStartedAt(t); setNow(t); }}><Timer className="size-4" />Start {q.minutes}-minute timer</Button>
            </>
          ) : (
            <>
              <div className={cx("text-[44px] font-bold tabular text-center leading-none my-2", left < 0 ? "text-danger" : left < 60 ? "text-warn" : "")}>{fmt(left)}</div>
              <p className="text-center text-xs text-ink-3 mb-3">{left < 0 ? "Over time: in the exam, move on." : "Time left"}</p>
              <Button size="lg" onClick={() => { setNow(Date.now()); setRevealed(true); }}><Eye className="size-4" />I&apos;m done, reveal the model answer</Button>
            </>
          )}
          <details className="mt-3"><summary className="text-sm text-ink-3 cursor-pointer">Stuck? Show the skeleton</summary><ol className="list-decimal pl-5 text-sm text-ink-2 mt-2 space-y-1">{q.skeleton.map((s, i) => <li key={i}>{s}</li>)}</ol></details>
        </Card>
      )}

      {revealed && (
        <>
          <Card title="Skeleton">
            <ol className="list-decimal pl-5 text-sm text-ink-2 space-y-1">{q.skeleton.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </Card>
          <Card title="Model answer"><Answer text={q.answer} /></Card>
          <Card title="What the examiner looks for">
            <ul className="text-sm text-ink-2 space-y-1">{q.examiner.map((s, i) => <li key={i} className="flex gap-2"><Check className="size-4 text-accent shrink-0 mt-0.5" />{s}</li>)}</ul>
          </Card>
          {mode === "attempt" && (
            <Card title="Mark yourself">
              {startedAt && <p className="text-sm text-ink-2 mb-3">You took <b>{fmt(elapsed)}</b> of {q.minutes}:00.</p>}
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Score (out of ${q.marks})`}><Input inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} placeholder={`0–${q.marks}`} /></Field>
                <Field label="Words you couldn't read"><Input inputMode="numeric" value={illegible} onChange={(e) => setIllegible(e.target.value.replace(/\D/g, ""))} placeholder="0" /></Field>
              </div>
              {attemptsError && /answer_attempts/.test(attemptsError) && <p className="text-xs text-warn mt-2">Saving needs the answer-practice table: run supabase/migrations/20261114_answer_attempts.sql in Supabase.</p>}
              <Button size="lg" className="mt-3" onClick={save} loading={busy} disabled={saved}><PenLine className="size-4" />{saved ? "Saved" : "Save attempt"}</Button>
            </Card>
          )}
        </>
      )}
      {onNext && <Button variant="secondary" className="w-full" onClick={onNext}>Next question<ChevronRight className="size-4" /></Button>}
    </div>
  );
}
