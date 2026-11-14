"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Upload, Play, RotateCcw, Trash2, Pencil, Layers, ArrowLeft, Repeat } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { dayKey, addDays, dayStartISO } from "@/lib/format";
import { schedule, intervalLabel, parseCardFile, type Grade, type ParsedCard, type Confidence } from "@/lib/srs";
import { Card, Spinner, ErrorBox, Button, Empty, Badge, Stat, Select, Input, Textarea, Field, Sheet, useToast, ListRow, Confirm, cx } from "@/components/ui";

export type Flashcard = {
  id: string; deck: string; front: string; back: string; tags: string[]; confidence: Confidence | null;
  ease: number; interval_days: number; repetitions: number; lapses: number; due_date: string; last_reviewed_at: string | null; suspended: boolean;
};
const COLS = "id, deck, front, back, tags, confidence, ease, interval_days, repetitions, lapses, due_date, last_reviewed_at, suspended";

const CONF: Record<Confidence, { label: string; tone: "accent" | "warn" | "danger" }> = {
  green: { label: "Certain", tone: "accent" }, yellow: { label: "Check source", tone: "warn" }, red: { label: "Do not rely", tone: "danger" },
};

export function Flashcards() {
  const today = dayKey();
  const { data, error, loading, reload } = useLive(async () => {
    const [cards, reviews] = await Promise.all([
      must(supabase.from("flashcards").select(COLS).order("deck").order("created_at").limit(5000)),
      must(supabase.from("flashcard_reviews").select("id").gte("reviewed_at", dayStartISO(today))),
    ]);
    return { cards: cards as Flashcard[], reviewedToday: (reviews as unknown[]).length };
  }, ["flashcards", "flashcard_reviews"]);
  const [deck, setDeck] = useState("");
  const [mode, setMode] = useState<"home" | "review" | "import" | "browse">("home");
  const [edit, setEdit] = useState<Partial<Flashcard> | null>(null);

  if (error) return <ErrorBox error={/flashcard/.test(error) && /exist|schema cache/i.test(error) ? "The flashcards table isn't set up yet. Run supabase/migrations/20261114_flashcards.sql in Supabase → SQL Editor, then retry." : error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const cards = data.cards.filter((c) => !c.suspended);
  const decks = [...new Set(data.cards.map((c) => c.deck))].sort();
  const inDeck = cards.filter((c) => !deck || c.deck === deck);
  const due = inDeck.filter((c) => c.due_date <= today).sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  const fresh = inDeck.filter((c) => c.repetitions === 0 && !c.last_reviewed_at).length;
  const tomorrow = inDeck.filter((c) => c.due_date === addDays(today, 1)).length;

  if (mode === "review") return <Review queue={due} onExit={() => { setMode("home"); reload(); }} />;
  if (mode === "import") return <Import decks={decks} onDone={() => { setMode("home"); reload(); }} onCancel={() => setMode("home")} />;

  return (
    <div className="grid gap-3 lg:gap-4 lg:grid-cols-3">
      <Card title="Flashcards" className="lg:col-span-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <Stat label="Due now" value={due.length} />
          <Stat label="Reviewed today" value={data.reviewedToday} />
          <Stat label="Never seen" value={fresh} />
          <Stat label="Due tomorrow" value={tomorrow} />
        </div>
        <Select value={deck} onChange={(e) => setDeck(e.target.value)} className="mb-3"><option value="">All decks ({cards.length} cards)</option>{decks.map((d) => <option key={d} value={d}>{d} ({cards.filter((c) => c.deck === d).length})</option>)}</Select>
        {due.length ? <Button size="lg" onClick={() => setMode("review")}><Play className="size-4" />Review {due.length} card{due.length === 1 ? "" : "s"}</Button>
          : <Empty title={cards.length ? "All caught up" : "No flashcards yet"} body={cards.length ? `Next cards are due ${tomorrow ? "tomorrow" : "later"}.` : "Import a card file or add cards by hand."} />}
        <div className="flex flex-wrap gap-2 mt-3">
          <Button variant="secondary" onClick={() => setMode("import")}><Upload className="size-4" />Import cards</Button>
          <Button variant="secondary" onClick={() => setEdit({ deck: deck || decks[0] || "" })}><Plus className="size-4" />Add card</Button>
          {inDeck.length > 0 && <Button variant="ghost" onClick={() => setMode(mode === "browse" ? "home" : "browse")}><Layers className="size-4" />{mode === "browse" ? "Hide cards" : "Browse cards"}</Button>}
        </div>
      </Card>
      <Card title="Decks" pad={false}>
        {decks.length ? decks.map((d) => {
          const dc = cards.filter((c) => c.deck === d);
          const dd = dc.filter((c) => c.due_date <= today).length;
          return <ListRow key={d} onClick={() => setDeck(d)} right={dd ? <Badge tone="info">{dd} due</Badge> : <Badge>{dc.length}</Badge>}><div className={cx("font-medium truncate", deck === d && "text-accent")}>{d}</div></ListRow>;
        }) : <Empty title="No decks" />}
      </Card>
      {mode === "browse" && <Browse cards={inDeck} today={today} onEdit={setEdit} />}
      <CardEditor key={edit ? edit.id ?? "new" : "closed"} card={edit} decks={decks} onClose={() => setEdit(null)} onSaved={reload} />
    </div>
  );
}

// ---------------- Review session ----------------
function Review({ queue: initial, onExit, practice = false }: { queue: Flashcard[]; onExit: () => void; practice?: boolean }) {
  const toast = useToast();
  const [queue, setQueue] = useState(initial);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const card = queue[0];

  async function grade(g: Grade) {
    if (!card || busy) return;
    const next = schedule(card, g);
    const due_date = addDays(dayKey(), next.interval_days);
    if (!practice) {
      // Practice runs (cards not yet due) don't change the schedule.
      setBusy(true);
      const { error } = await supabase.from("flashcards").update({ ...next, due_date, last_reviewed_at: new Date().toISOString() }).eq("id", card.id);
      if (!error) await supabase.from("flashcard_reviews").insert({ card_id: card.id, grade: g, interval_days: next.interval_days });
      setBusy(false);
      if (error) { toast(errMsg(error), "err"); return; }
    }
    setDone((n) => n + 1);
    setShown(false);
    setQueue((q) => next.interval_days === 0 ? [...q.slice(1), practice ? card : { ...card, ...next, due_date }] : q.slice(1));
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === " " && !shown) { e.preventDefault(); setShown(true); }
      else if (shown && ["1", "2", "3", "4"].includes(e.key)) grade((["again", "hard", "good", "easy"] as Grade[])[+e.key - 1]);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  if (!card) return (
    <Card><Empty title="Session complete" body={`You reviewed ${done} card${done === 1 ? "" : "s"}.`} action={<Button onClick={onExit}>Done</Button>} /></Card>
  );
  const opts: { g: Grade; label: string; cls: string }[] = [
    { g: "again", label: "Again", cls: "bg-danger/15 text-danger hover:bg-danger/25" },
    { g: "hard", label: "Hard", cls: "bg-warn/15 text-warn hover:bg-warn/25" },
    { g: "good", label: "Good", cls: "bg-accent/15 text-accent hover:bg-accent/25" },
    { g: "easy", label: "Easy", cls: "bg-info/15 text-info hover:bg-info/25" },
  ];
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-2 text-sm text-ink-3">
        <span className="truncate">{card.deck}{practice ? " · practice (schedule unchanged)" : ""}</span>
        <span className="tabular shrink-0">{queue.length} left · {done} done</span>
      </div>
      <Card>
        <div className="min-h-[38dvh] flex flex-col">
          <p className="text-[19px] font-semibold leading-snug whitespace-pre-line">{card.front}</p>
          {shown && (
            <div className="mt-5 pt-5 border-t border-line-soft anim-fade">
              <p className="text-[17px] leading-relaxed whitespace-pre-line">{card.back}</p>
              {card.confidence && <div className="mt-3"><Badge tone={CONF[card.confidence].tone}>{CONF[card.confidence].label}</Badge></div>}
            </div>
          )}
        </div>
      </Card>
      <div className="mt-3">
        {!shown ? <Button size="lg" onClick={() => setShown(true)}>Show answer</Button> : (
          <div className="grid grid-cols-4 gap-2">
            {opts.map((o) => (
              <button key={o.g} disabled={busy} onClick={() => grade(o.g)} className={cx("h-[60px] rounded-xl font-semibold flex flex-col items-center justify-center transition active:scale-[.98] disabled:opacity-50", o.cls)}>
                <span>{o.label}</span>{!practice && <span className="text-xs font-medium opacity-80">{intervalLabel(schedule(card, o.g).interval_days)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-between items-center mt-3">
        <Button variant="ghost" size="sm" onClick={onExit}><RotateCcw className="size-4" />End session</Button>
        <span className="text-xs text-ink-3 hidden lg:block">Space = show · 1–4 = grade</span>
      </div>
    </div>
  );
}

// ---------------- Import ----------------
function deckFromFilename(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\banki\b/i, "").replace(/\s+/g, " ").trim();
}

function Import({ decks, onDone, onCancel }: { decks: string[]; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [parsed, setParsed] = useState<{ cards: ParsedCard[]; problems: string[] } | null>(null);
  const [deck, setDeck] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(f: File) {
    const text = await f.text();
    const res = parseCardFile(text);
    setParsed(res);
    setDeck((d) => d || deckFromFilename(f.name));
    if (!res.cards.length) toast("No cards found in that file", "err");
  }
  async function run() {
    if (!parsed || !deck.trim()) return;
    setBusy(true);
    try {
      const rows = parsed.cards.map((c) => ({ deck: deck.trim(), front: c.front, back: c.back, tags: c.tags, confidence: c.confidence }));
      let added = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const { data, error } = await supabase.from("flashcards").upsert(rows.slice(i, i + 200), { onConflict: "user_id,deck,front", ignoreDuplicates: true }).select("id");
        if (error) throw error;
        added += data?.length ?? 0;
      }
      toast(added < rows.length ? `Added ${added} cards (${rows.length - added} already there)` : `Added ${added} cards`);
      onDone();
    } catch (e) { toast(errMsg(e), "err"); } finally { setBusy(false); }
  }
  return (
    <Card title="Import flashcards">
      <p className="text-sm text-ink-2 mb-4">Choose an Anki text file (.txt) or any tab-separated file: question, answer, then optional tags. Cards already in the deck are skipped, so re-importing is safe. 🟢/🟡/🔴 tags in answers become confidence badges.</p>
      <label className="flex flex-col items-center justify-center gap-2 h-32 rounded-2xl border-2 border-dashed border-line hover:border-accent/50 cursor-pointer text-ink-2">
        <Upload className="size-6" /><span className="text-sm font-medium">Choose card file</span>
        <input type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {parsed && (
        <div className="mt-4 space-y-3">
          <Field label="Deck (usually the case name)"><Input list="fc-decks" value={deck} onChange={(e) => setDeck(e.target.value)} placeholder="e.g. Maneka Gandhi" /></Field>
          <datalist id="fc-decks">{decks.map((d) => <option key={d} value={d} />)}</datalist>
          <div className="flex flex-wrap gap-2"><Badge tone="accent">{parsed.cards.length} cards</Badge>{parsed.problems.length > 0 && <Badge tone="warn">{parsed.problems.length} warnings</Badge>}</div>
          {parsed.problems.length > 0 && <ul className="text-xs text-warn space-y-1 max-h-24 overflow-y-auto">{parsed.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          <div className="rounded-xl border border-line-soft max-h-64 overflow-auto text-sm">
            {parsed.cards.slice(0, 100).map((c, i) => <div key={i} className="px-3 py-2 border-t border-line-soft first:border-t-0"><div className="font-medium">{c.front}</div><div className="text-ink-3 whitespace-pre-line">{c.back}</div></div>)}
          </div>
          <Button size="lg" onClick={run} loading={busy} disabled={!parsed.cards.length || !deck.trim()}>Import {parsed.cards.length} cards</Button>
        </div>
      )}
      <Button variant="ghost" className="mt-3" onClick={onCancel}>Cancel</Button>
    </Card>
  );
}

// ---------------- Browse & edit ----------------
function Browse({ cards, today, onEdit }: { cards: Flashcard[]; today: string; onEdit: (c: Flashcard) => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return s ? cards.filter((c) => (c.front + " " + c.back).toLowerCase().includes(s)) : cards; }, [cards, q]);
  return (
    <Card title={`Cards (${list.length})`} pad={false} className="lg:col-span-3">
      <div className="px-4 pb-3 lg:px-5"><Input placeholder="Search questions and answers" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {list.slice(0, 300).map((c) => (
        <ListRow key={c.id} onClick={() => onEdit(c)} right={<Badge tone={c.due_date <= today ? "info" : "neutral"}>{c.due_date <= today ? "due" : intervalLabel(c.interval_days)}</Badge>}>
          <div className="font-medium truncate">{c.front}</div>
          <div className="text-xs text-ink-3 truncate">{c.back.replace(/\n/g, " · ")}</div>
        </ListRow>
      ))}
    </Card>
  );
}

function CardEditor({ card, decks, onClose, onSaved }: { card: Partial<Flashcard> | null; decks: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Partial<Flashcard>>(card ?? {});
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const set = (k: keyof Flashcard, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    if (!f.deck?.trim() || !f.front?.trim()) { toast("Deck and question are required", "err"); return; }
    setBusy(true);
    const row = { deck: f.deck.trim(), front: f.front.trim(), back: (f.back ?? "").trim(), confidence: f.confidence ?? null };
    const { error } = f.id ? await supabase.from("flashcards").update(row).eq("id", f.id) : await supabase.from("flashcards").insert(row);
    setBusy(false);
    if (error) toast(/duplicate|unique/i.test(error.message) ? "That question already exists in this deck" : errMsg(error), "err");
    else { toast(f.id ? "Card updated" : "Card added"); onSaved(); if (f.id) onClose(); else setF({ deck: row.deck }); }
  }
  return (
    <>
      <Sheet open={!!card} onClose={onClose} title={f.id ? "Edit card" : "Add card"}>
        <div className="space-y-3">
          <Field label="Deck"><Input list="fc-decks-ed" value={f.deck ?? ""} onChange={(e) => set("deck", e.target.value)} placeholder="e.g. Maneka Gandhi" /></Field>
          <datalist id="fc-decks-ed">{decks.map((d) => <option key={d} value={d} />)}</datalist>
          <Field label="Question (front)"><Textarea value={f.front ?? ""} onChange={(e) => set("front", e.target.value)} /></Field>
          <Field label="Answer (back)"><Textarea value={f.back ?? ""} onChange={(e) => set("back", e.target.value)} /></Field>
          <Field label="Confidence"><Select value={f.confidence ?? ""} onChange={(e) => set("confidence", e.target.value || null)}><option value="">None</option><option value="green">🟢 Certain</option><option value="yellow">🟡 Check source</option><option value="red">🔴 Do not rely</option></Select></Field>
          <div className="flex gap-2 pt-1">
            {f.id && <Button variant="danger" onClick={() => setDel(true)}><Trash2 className="size-4" /></Button>}
            <Button className="flex-1" onClick={save} loading={busy}>{f.id ? <><Pencil className="size-4" />Save</> : <><Plus className="size-4" />Add card</>}</Button>
          </div>
        </div>
      </Sheet>
      <Confirm open={del} title="Delete this card?" body="Its review history will be deleted too." onClose={() => setDel(false)}
        onConfirm={async () => { const { error } = await supabase.from("flashcards").delete().eq("id", f.id!); if (error) toast(errMsg(error), "err"); else { onSaved(); onClose(); } }} />
    </>
  );
}

// ---------------- Flashcards for one case (opened from the checklist / judgment) ----------------
const words = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
/** A deck belongs to a case when every word of the deck name appears in the case name (e.g. "Maneka Gandhi"). */
export function deckMatches(deck: string, caseName: string) {
  const d = words(deck), c = new Set(words(caseName));
  return d.length > 0 && d.every((w) => c.has(w));
}
/** Short deck name for a case: the part before " v. ". */
export function deckNameFor(caseName: string) {
  return caseName.split(/\s+v(?:s)?\.?\s+/i)[0].replace(/^(his holiness|smt\.?|dr\.?|m\/s\.?)\s+/i, "").replace(/\s+(and|&)\s+(ors|anr|others)\.?.*$/i, "").trim() || caseName;
}

export function CaseFlashcards({ caseName, onClose }: { caseName: string | null; onClose: () => void }) {
  const today = dayKey();
  const [mode, setMode] = useState<"menu" | "due" | "all">("menu");
  const [adding, setAdding] = useState<Partial<Flashcard> | null>(null);
  const { data, error, loading, reload } = useLive(async () => {
    if (!caseName) return [] as Flashcard[];
    const all = await must(supabase.from("flashcards").select(COLS).eq("suspended", false).order("created_at").limit(5000));
    return (all as Flashcard[]).filter((c) => deckMatches(c.deck, caseName));
  }, ["flashcards"], [caseName]);
  useEffect(() => {
    if (!caseName) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && !adding && onClose();
    window.addEventListener("keydown", k);
    const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = o; };
  }, [caseName, onClose, adding]);
  if (!caseName) return null;
  const cards = data ?? [];
  const due = cards.filter((c) => c.due_date <= today);
  const decks = [...new Set(cards.map((c) => c.deck))];
  const back = () => { setMode("menu"); reload(); };
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg anim-fade" role="dialog" aria-modal="true" aria-label={`Flashcards: ${caseName}`}>
      <div className="flex items-center gap-2 px-2 pt-[calc(env(safe-area-inset-top)+6px)] pb-2 border-b border-line-soft bg-surface">
        <button onClick={onClose} className="h-10 px-2 rounded-lg flex items-center gap-1 text-ink-2 hover:bg-surface-2 shrink-0" aria-label="Back"><ArrowLeft className="size-5" /><span className="text-sm font-medium">Back</span></button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-sm font-semibold truncate">{caseName}</div>
          <div className="text-[11px] text-ink-3 truncate">Flashcards</div>
        </div>
        <span className="w-[72px] shrink-0" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 safe-bottom">
        {error ? <ErrorBox error={/flashcard/.test(error) && /exist|schema cache/i.test(error) ? "The flashcards table isn't set up yet. Run supabase/migrations/20261114_flashcards.sql in Supabase → SQL Editor, then retry." : error} onRetry={reload} />
          : loading && !data ? <Spinner />
          : mode === "due" ? <Review queue={due} onExit={back} />
          : mode === "all" ? <Review queue={cards} onExit={back} practice />
          : (
            <div className="max-w-2xl mx-auto">
              <Card>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <Stat label="Cards" value={cards.length} />
                  <Stat label="Due now" value={due.length} />
                  <Stat label="Deck" value={<span className="text-base">{decks.join(", ") || "—"}</span>} />
                </div>
                {cards.length ? (
                  <div className="space-y-2">
                    {due.length > 0 && <Button size="lg" onClick={() => setMode("due")}><Play className="size-4" />Review {due.length} due card{due.length === 1 ? "" : "s"}</Button>}
                    <Button size="lg" variant={due.length ? "secondary" : "primary"} onClick={() => setMode("all")}><Repeat className="size-4" />Practise all {cards.length} card{cards.length === 1 ? "" : "s"}</Button>
                    <p className="text-xs text-ink-3 text-center">Practice doesn&apos;t change when cards are next due. Only &ldquo;Review&rdquo; does.</p>
                  </div>
                ) : <Empty title="No flashcards for this case yet" body="Add your anchor cards here, or import a card file from the Flashcards tab." />}
                <Button variant="secondary" className="w-full mt-3" onClick={() => setAdding({ deck: decks[0] ?? deckNameFor(caseName) })}><Plus className="size-4" />Add a card</Button>
              </Card>
            </div>
          )}
      </div>
      <CardEditor key={adding ? "new" : "closed"} card={adding} decks={decks} onClose={() => setAdding(null)} onSaved={reload} />
    </div>
  );
}
