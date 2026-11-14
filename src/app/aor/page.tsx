"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { Plus, Play, Square, Upload, Search, AlertTriangle, CalendarClock, Trash2, Download, X } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { dayKey, addDays, fmtDay, num, weekStart, dayStartISO } from "@/lib/format";
import { useAuth } from "@/components/auth";
import { Card, PageHeader, Spinner, ErrorBox, Button, Empty, Badge, Bar, Stat, Segmented, Select, Input, Field, Sheet, useToast, ListRow, Confirm, cx } from "@/components/ui";
import { BarChartBox } from "@/components/charts";
import { JudgmentSheet } from "./judgment-sheet";
import { STATUSES, statusIdx, type Judgment, type Subject } from "./types";
import { Checklist } from "./checklist";
import { Flashcards } from "./flashcards";
import { Briefs, BriefViewer, type Brief } from "./briefs";

type Session = { id: string; judgment_id: string | null; started_at: string; ended_at: string | null; duration_minutes: number | null; activity: string };
type Mock = { id: string; title: string; taken_on: string; max_marks: number; marks_obtained: number | null; subject_id: string | null; notes: string | null };

export default function AorPage() {
  const [tab, setTab] = useState<"plan" | "briefs" | "flashcards" | "checklist" | "judgments" | "calendar" | "mocks" | "import">("plan");
  const [sheet, setSheet] = useState<{ open: boolean; j: Partial<Judgment> | null }>({ open: false, j: null });
  const [brief, setBrief] = useState<Brief | null>(null);
  const closeBrief = useCallback(() => setBrief(null), []);
  useEffect(() => { if (typeof window !== "undefined" && window.location.hash === "#import") setTab("import"); else if (typeof window !== "undefined" && window.location.hash === "#flashcards") setTab("flashcards"); else if (typeof window !== "undefined" && window.location.hash === "#briefs") setTab("briefs"); }, []);

  const { data, error, loading, reload } = useLive(async () => {
    const since = addDays(dayKey(), -27);
    const [subjects, judgments, sessions] = await Promise.all([
      must(supabase.from("subjects").select("id, name, sort_order").order("sort_order").order("name")),
      must(supabase.from("judgments").select("id, subject_id, case_name, citation, court, year, topic, facts, issues, ratio_decidendi, obiter_dicta, important_paragraphs, statutory_provisions, personal_notes, status, first_reading_date, confidence, is_difficult, next_review_date, sr_interval_days, sr_repetitions, updated_at").order("case_name").limit(2000)),
      must(supabase.from("study_sessions").select("id, judgment_id, started_at, ended_at, duration_minutes, activity").gte("started_at", dayStartISO(since)).order("started_at", { ascending: false })),
    ]);
    return { subjects: subjects as Subject[], judgments: judgments as Judgment[], sessions: sessions as Session[] };
  }, ["judgments", "subjects", "study_sessions", "revision_records"]);

  const open = (j: Partial<Judgment> | null) => setSheet({ open: true, j });
  return (
    <>
      <PageHeader title="AOR preparation" subtitle="Advocate-on-Record examination" action={<Button onClick={() => open({ status: "not_started" })}><Plus className="size-4" />Judgment</Button>} />
      <div className="mb-4"><Segmented value={tab} onChange={setTab} options={[{ value: "plan", label: "Today" }, { value: "briefs", label: "Briefs" }, { value: "flashcards", label: "Flashcards" }, { value: "checklist", label: "Checklist" }, { value: "judgments", label: "Judgments" }, { value: "calendar", label: "Revision calendar" }, { value: "mocks", label: "Mock tests" }, { value: "import", label: "Import CSV" }]} /></div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : data && (
        <>
          {tab === "plan" && <Plan {...data} onOpen={open} reload={reload} />}
          {tab === "briefs" && <Briefs judgments={data.judgments} onOpen={setBrief} />}
          {tab === "flashcards" && <Flashcards />}
          {tab === "checklist" && <Checklist subjects={data.subjects} judgments={data.judgments} reload={reload} onBrief={setBrief} />}
          {tab === "judgments" && <JudgmentList {...data} onOpen={open} />}
          {tab === "calendar" && <Calendar judgments={data.judgments} onOpen={open} reload={reload} />}
          {tab === "mocks" && <Mocks subjects={data.subjects} />}
          {tab === "import" && <Import subjects={data.subjects} judgments={data.judgments} onDone={() => { reload(); setTab("judgments"); }} />}
        </>
      )}
      <JudgmentSheet open={sheet.open} judgment={sheet.j} subjects={data?.subjects ?? []} onClose={() => setSheet({ open: false, j: null })} onSaved={reload} onBrief={setBrief} />
      <BriefViewer brief={brief} onClose={closeBrief} />
    </>
  );
}

// ---------------- Today: plan, timer, progress ----------------
function Plan({ subjects, judgments, sessions, onOpen, reload }: { subjects: Subject[]; judgments: Judgment[]; sessions: Session[]; onOpen: (j: Judgment) => void; reload: () => void }) {
  const { profile } = useAuth();
  const today = dayKey();
  const dailyTarget = profile?.aor_daily_target_judgments ?? 3;
  const weeklyTarget = profile?.aor_weekly_target_judgments ?? 15;
  const total = judgments.length;
  const firstRead = judgments.filter((j) => statusIdx(j.status) >= 2).length;
  const due = judgments.filter((j) => j.next_review_date && j.next_review_date <= today).sort((a, b) => (a.next_review_date! < b.next_review_date! ? -1 : 1));
  const fresh = judgments.filter((j) => j.status === "not_started" || j.status === "reading").slice(0, Math.max(0, dailyTarget));
  const difficult = judgments.filter((j) => j.is_difficult);
  const todaySessions = sessions.filter((s) => dayKey(new Date(s.started_at)) === today);
  const studiedToday = new Set(todaySessions.map((s) => s.judgment_id).filter(Boolean)).size;
  const minutesToday = todaySessions.reduce((s, x) => s + (x.duration_minutes ?? 0), 0);
  const wk = weekStart(today);
  const weekStudied = new Set(sessions.filter((s) => dayKey(new Date(s.started_at)) >= wk).map((s) => s.judgment_id).filter(Boolean)).size;

  const chart = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today, i - 13);
    return { day: fmtDay(d, { day: "numeric", month: "short" }), minutes: sessions.filter((s) => dayKey(new Date(s.started_at)) === d).reduce((a, s) => a + (s.duration_minutes ?? 0), 0) };
  });

  const bySubject = subjects.map((s) => {
    const js = judgments.filter((j) => j.subject_id === s.id);
    return { s, total: js.length, done: js.filter((j) => statusIdx(j.status) >= 2).length, rev2: js.filter((j) => statusIdx(j.status) >= 4).length };
  }).filter((x) => x.total > 0);
  const unassigned = judgments.filter((j) => !j.subject_id).length;

  return (
    <div className="grid gap-3 lg:gap-4 lg:grid-cols-3">
      <Timer judgments={judgments} sessions={sessions} reload={reload} />
      <Card title="Progress">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Syllabus (first read)" value={total ? `${Math.round((firstRead / total) * 100)}%` : "—"} sub={`${firstRead} of ${total}`} />
          <Stat label="Today" value={`${studiedToday}/${dailyTarget}`} sub={`${minutesToday} min studied`} />
          <Stat label="This week" value={`${weekStudied}/${weeklyTarget}`} sub="judgments" />
          <Stat label="Due reviews" value={due.length} sub={`${difficult.length} difficult`} />
        </div>
      </Card>
      <Card title="Study minutes · 14 days">
        <BarChartBox data={chart} x="day" bars={[{ key: "minutes", name: "Minutes" }]} height={160} />
      </Card>

      <Card title={`Due for review (${due.length})`} pad={false} className="lg:col-span-2">
        {due.length ? due.slice(0, 12).map((j) => (
          <ListRow key={j.id} onClick={() => onOpen(j)} right={<Badge tone={j.next_review_date! < today ? "warn" : "info"}>{j.next_review_date! < today ? `overdue ${fmtDay(j.next_review_date!)}` : "today"}</Badge>}>
            <div className="font-medium truncate">{j.case_name}</div>
            <div className="text-xs text-ink-3 truncate">{j.citation ?? ""} · {STATUSES[statusIdx(j.status)].short}{j.is_difficult ? " · difficult" : ""}</div>
          </ListRow>
        )) : <Empty title="No reviews due" body={total ? "You're up to date. New cases below." : "Import or add judgments to begin."} />}
      </Card>
      <Card title={`New reading (target ${dailyTarget}/day)`} pad={false}>
        {fresh.length ? fresh.map((j) => (
          <ListRow key={j.id} onClick={() => onOpen(j)}><div className="font-medium truncate">{j.case_name}</div><div className="text-xs text-ink-3 truncate">{subjects.find((s) => s.id === j.subject_id)?.name ?? "No subject"}</div></ListRow>
        )) : <Empty title={total ? "Every judgment has been started" : "No judgments yet"} />}
      </Card>

      <Card title="Subject-wise progress" className="lg:col-span-2">
        {bySubject.length ? (
          <div className="space-y-3">{bySubject.map(({ s, total, done, rev2 }) => (
            <div key={s.id}>
              <div className="flex justify-between text-sm mb-1"><span className="font-medium truncate">{s.name}</span><span className="tabular text-ink-3">{done}/{total} read · {rev2} revised twice</span></div>
              <Bar value={done} max={total} />
            </div>
          ))}{unassigned > 0 && <p className="text-xs text-ink-3">{unassigned} judgments without a subject.</p>}</div>
        ) : <Empty title="No subjects yet" body="Subjects are created automatically from your CSV import." />}
      </Card>
      <Card title={`Difficult judgments (${difficult.length})`} pad={false}>
        {difficult.length ? difficult.slice(0, 10).map((j) => (
          <ListRow key={j.id} onClick={() => onOpen(j)}><div className="flex items-center gap-2"><AlertTriangle className="size-4 text-warn shrink-0" /><span className="truncate font-medium">{j.case_name}</span></div></ListRow>
        )) : <Empty title="None flagged" />}
      </Card>
    </div>
  );
}

function Timer({ judgments, sessions, reload }: { judgments: Judgment[]; sessions: Session[]; reload: () => void }) {
  const toast = useToast();
  const running = sessions.find((s) => !s.ended_at);
  const [jid, setJid] = useState("");
  const [activity, setActivity] = useState("reading");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  const elapsed = running ? Math.max(0, Math.floor((now - new Date(running.started_at).getTime()) / 1000)) : 0;
  const hh = Math.floor(elapsed / 3600), mm = Math.floor((elapsed % 3600) / 60), ss = elapsed % 60;

  async function start() {
    setBusy(true);
    const { error } = await supabase.from("study_sessions").insert({ judgment_id: jid || null, started_at: new Date().toISOString(), activity });
    setBusy(false);
    if (error) toast(/one_open|duplicate/i.test(error.message) ? "A timer is already running (maybe on another device)" : errMsg(error), "err"); else reload();
  }
  async function stop() {
    if (!running) return;
    setBusy(true);
    const end = new Date(Math.min(Date.now(), new Date(running.started_at).getTime() + 16 * 3600 * 1000)).toISOString();
    const { error } = await supabase.from("study_sessions").update({ ended_at: end }).eq("id", running.id);
    if (!error && running.judgment_id) {
      const j = judgments.find((x) => x.id === running.judgment_id);
      if (j?.status === "not_started") await supabase.from("judgments").update({ status: "reading" }).eq("id", j.id);
    }
    setBusy(false);
    if (error) toast(errMsg(error), "err"); else { toast(`Logged ${Math.max(1, Math.round(elapsed / 60))} min`); reload(); }
  }
  const runningJ = running?.judgment_id ? judgments.find((j) => j.id === running.judgment_id) : null;
  return (
    <Card title="Study timer">
      <div className="text-[44px] font-bold tabular tracking-tight leading-none text-center my-2">{String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}</div>
      {running ? (
        <>
          <p className="text-center text-sm text-ink-3 mb-3 truncate">{runningJ ? runningJ.case_name : "General study"} · {running.activity.replace("_", " ")}</p>
          <Button size="lg" variant="danger" onClick={stop} loading={busy}><Square className="size-4" />Stop & save</Button>
        </>
      ) : (
        <div className="space-y-2">
          <Select value={jid} onChange={(e) => setJid(e.target.value)}><option value="">General study (no specific judgment)</option>{judgments.map((j) => <option key={j.id} value={j.id}>{j.case_name}</option>)}</Select>
          <Select value={activity} onChange={(e) => setActivity(e.target.value)}>{["reading", "revision", "recall", "mock_test", "notes"].map((a) => <option key={a} value={a}>{a.replace("_", " ")}</option>)}</Select>
          <Button size="lg" onClick={start} loading={busy}><Play className="size-4" />Start</Button>
        </div>
      )}
      <p className="text-xs text-ink-3 mt-2 text-center">The timer lives in the cloud — start on iPhone, stop on Mac.</p>
    </Card>
  );
}

// ---------------- Judgment register ----------------
function JudgmentList({ subjects, judgments, onOpen }: { subjects: Subject[]; judgments: Judgment[]; onOpen: (j: Judgment) => void }) {
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  const [onlyDifficult, setOnlyDifficult] = useState(false);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return judgments.filter((j) =>
      (!s || [j.case_name, j.citation, j.topic, j.statutory_provisions].some((v) => v?.toLowerCase().includes(s))) &&
      (!subject || (subject === "none" ? !j.subject_id : j.subject_id === subject)) && (!status || j.status === status) && (!onlyDifficult || j.is_difficult));
  }, [judgments, q, subject, status, onlyDifficult]);
  const subjName = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? "—";
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <div className="relative col-span-2 lg:col-span-1"><Search className="size-4 absolute left-3 top-3.5 text-ink-3" /><Input className="pl-9" placeholder="Search case, citation, provision" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">All subjects</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="none">No subject</option></Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <label className="col-span-2 lg:col-span-1 flex items-center gap-2 text-sm text-ink-2 h-11"><input type="checkbox" className="size-5 accent-[#b5d86a]" checked={onlyDifficult} onChange={(e) => setOnlyDifficult(e.target.checked)} />Difficult only</label>
      </div>
      <p className="text-xs text-ink-3 mb-2">{list.length} of {judgments.length} judgments</p>
      {!judgments.length ? <Card><Empty title="No judgments yet" body="Import your prescribed judgments from CSV or add them one by one." /></Card> : (
        <Card pad={false}>
          {/* desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-ink-3 text-xs uppercase tracking-wider"><th className="px-4 py-3 font-medium">Case</th><th className="px-3 font-medium">Subject</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Conf.</th><th className="px-3 font-medium">Next review</th></tr></thead>
              <tbody>{list.map((j) => (
                <tr key={j.id} onClick={() => onOpen(j)} className="border-t border-line-soft hover:bg-surface-2 cursor-pointer">
                  <td className="px-4 py-2.5"><div className="font-medium flex items-center gap-2">{j.case_name}{j.is_difficult && <AlertTriangle className="size-3.5 text-warn" />}</div><div className="text-xs text-ink-3">{j.citation}</div></td>
                  <td className="px-3 text-ink-2">{subjName(j.subject_id)}</td>
                  <td className="px-3"><StatusPill s={j.status} /></td>
                  <td className="px-3 tabular">{j.confidence ?? "—"}</td>
                  <td className="px-3 tabular text-ink-2">{j.next_review_date ? fmtDay(j.next_review_date) : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="lg:hidden">{list.map((j) => (
            <ListRow key={j.id} onClick={() => onOpen(j)} right={<StatusPill s={j.status} />}>
              <div className="font-medium truncate flex items-center gap-1.5">{j.is_difficult && <AlertTriangle className="size-3.5 text-warn shrink-0" />}{j.case_name}</div>
              <div className="text-xs text-ink-3 truncate">{subjName(j.subject_id)}{j.next_review_date ? ` · review ${fmtDay(j.next_review_date)}` : ""}</div>
            </ListRow>
          ))}</div>
        </Card>
      )}
    </>
  );
}
function StatusPill({ s }: { s: Judgment["status"] }) {
  const i = statusIdx(s);
  return <Badge tone={i === 0 ? "neutral" : i === 1 ? "warn" : i >= 5 ? "accent" : "info"}>{STATUSES[i].short}</Badge>;
}

// ---------------- Revision calendar ----------------
function Calendar({ judgments, onOpen, reload }: { judgments: Judgment[]; onOpen: (j: Judgment) => void; reload: () => void }) {
  const toast = useToast();
  const today = dayKey();
  const [span, setSpan] = useState(14);
  const days = Array.from({ length: span }, (_, i) => addDays(today, i));
  const overdue = judgments.filter((j) => j.next_review_date && j.next_review_date < today);
  const unscheduled = judgments.filter((j) => !j.next_review_date).sort((a, b) => a.case_name.localeCompare(b.case_name));
  async function setDate(j: Judgment, d: string | null) {
    const { error } = await supabase.from("judgments").update({ next_review_date: d }).eq("id", j.id);
    if (error) toast(errMsg(error), "err"); else reload();
  }
  const row = (j: Judgment, tone?: "warn") => (
    <div key={j.id} className="flex items-center gap-2 px-4 py-2 border-t border-line-soft first:border-t-0">
      <button onClick={() => onOpen(j)} className={cx("flex-1 min-w-0 text-left text-sm truncate hover:text-accent", tone === "warn" && "text-warn")}>{j.case_name}</button>
      <input type="date" aria-label="Move to date" value={j.next_review_date ?? ""} onChange={(e) => e.target.value && setDate(j, e.target.value)} className="h-8 rounded-lg bg-surface-2 border border-line-soft px-2 text-xs text-ink-2" />
      <button onClick={() => setDate(j, null)} aria-label="Remove from calendar" title="Remove from calendar" className="size-8 grid place-items-center rounded-lg text-ink-3 hover:text-danger hover:bg-surface-2"><X className="size-4" /></button>
    </div>
  );
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <p className="text-xs text-ink-3 lg:col-span-2">Pick a date on any judgment to move it, × to take it off the calendar, or add one to a day. Ticking Read in the Checklist schedules Revision 1 a week later; ticking Revision 1 schedules Revision 2 three weeks later.</p>
      {overdue.length > 0 && (
        <Card title={`Overdue (${overdue.length})`} pad={false} className="lg:col-span-2">
          {overdue.map((j) => row(j, "warn"))}
        </Card>
      )}
      {days.map((d) => {
        const js = judgments.filter((j) => j.next_review_date === d);
        return (
          <Card key={d} pad={false} title={<span className="flex items-center gap-2"><CalendarClock className="size-4" />{d === today ? "Today" : fmtDay(d, { weekday: "short", day: "numeric", month: "short" })}</span>} action={<span className="text-xs text-ink-3">{js.length}</span>}>
            {js.map((j) => row(j))}
            <div className="px-4 py-2 border-t border-line-soft">
              <select value="" onChange={(e) => { const j = judgments.find((x) => x.id === e.target.value); if (j) setDate(j, d); }} className="w-full h-9 rounded-lg bg-surface-2 border border-line-soft px-2 text-sm text-ink-2" aria-label="Add a judgment to this day">
                <option value="">+ Add judgment to this day</option>
                {unscheduled.map((j) => <option key={j.id} value={j.id}>{j.case_name}</option>)}
              </select>
            </div>
          </Card>
        );
      })}
      <Button variant="secondary" className="lg:col-span-2" onClick={() => setSpan(span + 14)}>Show 2 more weeks</Button>
    </div>
  );
}

// ---------------- Mock tests ----------------
function Mocks({ subjects }: { subjects: Subject[] }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<Mock> | null>(null);
  const [del, setDel] = useState<Mock | null>(null);
  const { data, error, loading, reload } = useLive(async () => (await must(supabase.from("mock_tests").select("*").order("taken_on", { ascending: false }))) as Mock[], ["mock_tests"]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit?.title || !edit.max_marks) return;
    const row = { title: edit.title, taken_on: edit.taken_on || dayKey(), max_marks: Number(edit.max_marks), marks_obtained: edit.marks_obtained != null && String(edit.marks_obtained) !== "" ? Number(edit.marks_obtained) : null, subject_id: edit.subject_id || null, notes: edit.notes || null };
    const { error } = edit.id ? await supabase.from("mock_tests").update(row).eq("id", edit.id) : await supabase.from("mock_tests").insert(row);
    if (error) toast(errMsg(error), "err"); else { setEdit(null); reload(); toast("Saved"); }
  }
  const chart = (data ?? []).filter((m) => m.marks_obtained != null).slice().reverse().map((m) => ({ day: fmtDay(m.taken_on), pct: Math.round((Number(m.marks_obtained) / Number(m.max_marks)) * 100) }));
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {error && <ErrorBox error={error} onRetry={reload} />}
      <Card title="Scores (%)" className="lg:col-span-2">{chart.length ? <BarChartBox data={chart} x="day" bars={[{ key: "pct", name: "Score %" }]} height={200} /> : <Empty title="No scored mocks yet" />}</Card>
      <Card title="Summary">
        <Stat label="Tests taken" value={data?.length ?? 0} />
        <div className="mt-3"><Stat label="Average" value={chart.length ? `${Math.round(chart.reduce((a, c) => a + c.pct, 0) / chart.length)}%` : "—"} /></div>
        <Button className="mt-4 w-full" variant="secondary" onClick={() => setEdit({ taken_on: dayKey(), max_marks: 100 })}><Plus className="size-4" />Add mock test</Button>
      </Card>
      <Card pad={false} className="lg:col-span-3">
        {loading && !data ? <Spinner /> : data?.length ? data.map((m) => (
          <ListRow key={m.id} onClick={() => setEdit(m)} right={<button onClick={(e) => { e.stopPropagation(); setDel(m); }} className="size-9 grid place-items-center text-ink-3 hover:text-danger" aria-label="Delete"><Trash2 className="size-4" /></button>}>
            <div className="flex justify-between gap-2"><span className="font-medium truncate">{m.title}</span><span className="tabular">{m.marks_obtained != null ? `${num(m.marks_obtained)}/${num(m.max_marks)}` : "not scored"}</span></div>
            <div className="text-xs text-ink-3">{fmtDay(m.taken_on, { day: "numeric", month: "short", year: "numeric" })}{m.subject_id ? ` · ${subjects.find((s) => s.id === m.subject_id)?.name}` : ""}</div>
          </ListRow>
        )) : <Empty title="No mock tests logged" />}
      </Card>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit mock test" : "Add mock test"}>
        {edit && (
          <form onSubmit={save} className="space-y-4">
            <Field label="Title"><Input required value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="e.g. Paper II — Drafting mock" /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Date"><Input type="date" value={edit.taken_on ?? ""} onChange={(e) => setEdit({ ...edit, taken_on: e.target.value })} /></Field>
              <Field label="Marks"><Input inputMode="decimal" value={edit.marks_obtained ?? ""} onChange={(e) => setEdit({ ...edit, marks_obtained: e.target.value as unknown as number })} /></Field>
              <Field label="Out of"><Input inputMode="decimal" required value={edit.max_marks ?? ""} onChange={(e) => setEdit({ ...edit, max_marks: e.target.value as unknown as number })} /></Field>
            </div>
            <Field label="Subject"><Select value={edit.subject_id ?? ""} onChange={(e) => setEdit({ ...edit, subject_id: e.target.value || null })}><option value="">—</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Notes"><Input value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <Button size="lg" type="submit">Save</Button>
          </form>
        )}
      </Sheet>
      <Confirm open={!!del} title="Delete mock test?" body={del?.title} onClose={() => setDel(null)} onConfirm={async () => { const { error } = await supabase.from("mock_tests").delete().eq("id", del!.id); if (error) toast(errMsg(error), "err"); else reload(); }} />
    </div>
  );
}

// ---------------- CSV import ----------------
const COLS = ["case_name", "citation", "court", "year", "subject", "topic", "facts", "issues", "ratio_decidendi", "obiter_dicta", "important_paragraphs", "statutory_provisions", "personal_notes"] as const;
type Row = Partial<Record<(typeof COLS)[number], string>>;
const key = (n?: string | null, c?: string | null) => `${(n ?? "").trim().toLowerCase()}|${(c ?? "").trim().toLowerCase()}`;

function Import({ subjects, judgments, onDone }: { subjects: Subject[]; judgments: Judgment[]; onDone: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const existing = useMemo(() => new Set(judgments.map((j) => key(j.case_name, j.citation))), [judgments]);

  function onFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/^case$|^name$|^case_title$/, "case_name").replace(/^ratio$/, "ratio_decidendi").replace(/^obiter$/, "obiter_dicta").replace(/^provisions$|^statutes$/, "statutory_provisions").replace(/^notes$/, "personal_notes"),
      complete: (res) => {
        const out: Row[] = []; const probs: string[] = [];
        if (!res.meta.fields?.includes("case_name")) probs.push("No “case_name” column found. Use the template headers.");
        res.data.forEach((r, i) => {
          const row: Row = {};
          COLS.forEach((c) => { const v = r[c]?.trim(); if (v) row[c] = v; });
          if (!row.case_name) { probs.push(`Row ${i + 2}: missing case name — skipped`); return; }
          if (row.year && !/^\d{4}$/.test(row.year)) { probs.push(`Row ${i + 2}: year “${row.year}” ignored`); delete row.year; }
          out.push(row);
        });
        setRows(out); setProblems(probs);
      },
      error: (e) => toast(e.message, "err"),
    });
  }

  const fresh = (rows ?? []).filter((r, i, a) => !existing.has(key(r.case_name, r.citation)) && a.findIndex((x) => key(x.case_name, x.citation) === key(r.case_name, r.citation)) === i);
  const dupes = (rows?.length ?? 0) - fresh.length;

  async function run() {
    setBusy(true);
    try {
      const subjMap = new Map(subjects.map((s) => [s.name.trim().toLowerCase(), s.id]));
      const newSubjects = [...new Set(fresh.map((r) => r.subject?.trim()).filter((s): s is string => !!s && !subjMap.has(s.toLowerCase())))];
      if (newSubjects.length) {
        const ins = await supabase.from("subjects").insert(newSubjects.map((name, i) => ({ name, sort_order: subjects.length + i }))).select("id, name");
        if (ins.error) throw ins.error;
        (ins.data as Subject[]).forEach((s) => subjMap.set(s.name.toLowerCase(), s.id));
      }
      const batch = crypto.randomUUID();
      const payload = fresh.map((r) => ({
        case_name: r.case_name!, citation: r.citation ?? null, court: r.court ?? null, year: r.year ? Number(r.year) : null,
        subject_id: r.subject ? subjMap.get(r.subject.toLowerCase()) ?? null : null, topic: r.topic ?? null, facts: r.facts ?? null, issues: r.issues ?? null,
        ratio_decidendi: r.ratio_decidendi ?? null, obiter_dicta: r.obiter_dicta ?? null, important_paragraphs: r.important_paragraphs ?? null,
        statutory_provisions: r.statutory_provisions ?? null, personal_notes: r.personal_notes ?? null, import_batch_id: batch,
      }));
      for (let i = 0; i < payload.length; i += 100) {
        const { error } = await supabase.from("judgments").insert(payload.slice(i, i + 100));
        if (error) throw error;
      }
      toast(`Imported ${payload.length} judgments`);
      setRows(null); onDone();
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  }

  function template() {
    const blob = new Blob([COLS.join(",") + "\n"], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "aor_judgments_template.csv"; a.click();
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card title="Import prescribed judgments" className="lg:col-span-2">
        <p className="text-sm text-ink-2 mb-4">Upload a CSV with one judgment per row. Only <b>case_name</b> is required; subjects are created automatically. Rows already in your register (same case name and citation) are skipped, so re-importing is safe.</p>
        <label className="flex flex-col items-center justify-center gap-2 h-36 rounded-2xl border-2 border-dashed border-line hover:border-accent/50 cursor-pointer text-ink-2">
          <Upload className="size-6" /><span className="text-sm font-medium">Choose CSV file</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {rows && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2"><Badge tone="accent">{fresh.length} new</Badge>{dupes > 0 && <Badge>{dupes} already present</Badge>}{problems.length > 0 && <Badge tone="warn">{problems.length} warnings</Badge>}</div>
            {problems.length > 0 && <ul className="text-xs text-warn space-y-1 max-h-32 overflow-y-auto">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
            <div className="rounded-xl border border-line-soft max-h-64 overflow-auto text-sm">
              {fresh.slice(0, 100).map((r, i) => <div key={i} className={cx("px-3 py-2 border-t border-line-soft first:border-t-0")}><span className="font-medium">{r.case_name}</span><span className="text-ink-3"> {r.citation ? `· ${r.citation}` : ""} {r.subject ? `· ${r.subject}` : ""}</span></div>)}
            </div>
            <Button size="lg" onClick={run} loading={busy} disabled={!fresh.length}>Import {fresh.length} judgments</Button>
          </div>
        )}
      </Card>
      <Card title="CSV columns">
        <div className="flex flex-wrap gap-1.5">{COLS.map((c) => <Badge key={c} tone={c === "case_name" ? "accent" : "neutral"}>{c}</Badge>)}</div>
        <Button variant="secondary" className="mt-4 w-full" onClick={template}><Download className="size-4" />Download template</Button>
        <p className="text-xs text-ink-3 mt-3">Tip: in Excel or Numbers, export as “CSV UTF-8”.</p>
      </Card>
    </div>
  );
}
