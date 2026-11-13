"use client";
import { useState } from "react";
import { BookOpen, Clapperboard, Check, Trash2, Plus } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useLive, must } from "@/lib/hooks";
import { Card, PageHeader, Spinner, ErrorBox, Button, Input, Field, Segmented, Sheet, Textarea, Empty, Confirm, useToast, cx } from "@/components/ui";

type Kind = "book" | "movie";
type Item = { id: string; kind: Kind; title: string; creator: string | null; recommended_by: string | null; notes: string | null; done: boolean; done_at: string | null; created_at: string };

const SETUP_HINT = "The Books & Movies table isn't set up yet. Run supabase/migrations/20261113_recommendations.sql in Supabase → SQL Editor.";

export default function WatchlistPage() {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("book");
  const [show, setShow] = useState<"todo" | "done">("todo");
  const [title, setTitle] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Item | null>(null);

  const { data, error, loading, reload } = useLive(async () => (await must(supabase.from("recommendations").select("*").order("created_at", { ascending: false }))) as Item[], ["recommendations"]);
  const items = (data ?? []).filter((i) => i.kind === kind);
  const list = items.filter((i) => (show === "done" ? i.done : !i.done));
  const todoCount = (k: Kind) => (data ?? []).filter((i) => i.kind === k && !i.done).length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    const { error } = await supabase.from("recommendations").insert({ kind, title: t, recommended_by: by.trim() || null });
    setBusy(false);
    if (error) { toast(/relation|does not exist|schema cache/i.test(error.message) ? SETUP_HINT : errMsg(error), "err"); return; }
    setTitle(""); setBy(""); reload();
  }

  async function toggle(i: Item) {
    const done = !i.done;
    const { error } = await supabase.from("recommendations").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", i.id);
    if (error) toast(errMsg(error), "err"); else reload();
  }

  const noun = kind === "book" ? "book" : "movie";
  return (
    <>
      <PageHeader title="Books & Movies" subtitle="Recommendations to read and watch" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Segmented value={kind} onChange={setKind} options={[{ value: "book", label: `Books${todoCount("book") ? ` · ${todoCount("book")}` : ""}` }, { value: "movie", label: `Movies${todoCount("movie") ? ` · ${todoCount("movie")}` : ""}` }]} />
        <Segmented value={show} onChange={setShow} options={[{ value: "todo", label: kind === "book" ? "To read" : "To watch" }, { value: "done", label: "Done" }]} />
      </div>

      <Card className="mb-3">
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
          <Input className="flex-1" placeholder={kind === "book" ? "Book title (e.g. Sapiens)" : "Movie title (e.g. 12th Fail)"} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
          <Input className="sm:w-48" placeholder="Recommended by (optional)" value={by} onChange={(e) => setBy(e.target.value)} autoComplete="off" />
          <Button type="submit" disabled={busy || !title.trim()}><Plus className="size-4" />Add {noun}</Button>
        </form>
      </Card>

      {error && <ErrorBox error={/relation|does not exist|schema cache/i.test(error) ? SETUP_HINT : error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : !error && (
        <Card pad={false}>
          {list.length ? list.map((i) => (
            <div key={i.id} className="flex items-center gap-3 px-4 py-3 min-h-[56px] border-t border-line-soft first:border-t-0">
              <button onClick={() => toggle(i)} aria-label={i.done ? "Mark not done" : "Mark done"} className={cx("size-6 shrink-0 rounded-md border-2 grid place-items-center transition", i.done ? "bg-accent border-accent text-accent-ink" : "border-line hover:border-accent")}>
                {i.done && <Check className="size-4" strokeWidth={3} />}
              </button>
              <button onClick={() => setEdit(i)} className="flex-1 min-w-0 text-left">
                <div className={cx("font-medium truncate", i.done && "line-through text-ink-3")}>{i.title}</div>
                {(i.creator || i.recommended_by) && <div className="text-xs text-ink-3 truncate">{[i.creator, i.recommended_by && `rec. by ${i.recommended_by}`].filter(Boolean).join(" · ")}</div>}
              </button>
              {kind === "book" ? <BookOpen className="size-4 text-ink-3 shrink-0" /> : <Clapperboard className="size-4 text-ink-3 shrink-0" />}
            </div>
          )) : <Empty title={show === "done" ? `No ${noun}s ticked off yet` : `No ${noun}s on your list`} body={show === "todo" ? `Heard of a good ${noun}? Add it above.` : undefined} />}
        </Card>
      )}
      <EditSheet item={edit} onClose={() => setEdit(null)} onSaved={reload} />
    </>
  );
}

function EditSheet({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [del, setDel] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if ((item?.id ?? null) !== lastId) {
    setLastId(item?.id ?? null);
    if (item) setF({ title: item.title, creator: item.creator ?? "", recommended_by: item.recommended_by ?? "", notes: item.notes ?? "", kind: item.kind });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!item || !f.title?.trim()) return;
    const { error } = await supabase.from("recommendations").update({ title: f.title.trim(), kind: f.kind, creator: f.creator.trim() || null, recommended_by: f.recommended_by.trim() || null, notes: f.notes.trim() || null }).eq("id", item.id);
    if (error) toast(errMsg(error), "err"); else { toast("Saved"); onSaved(); onClose(); }
  }
  return (
    <Sheet open={!!item} onClose={onClose} title="Edit">
      <form onSubmit={save} className="space-y-4">
        <Segmented value={(f.kind as Kind) ?? "book"} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: "book", label: "Book" }, { value: "movie", label: "Movie" }]} />
        <Field label="Title"><Input value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label={f.kind === "movie" ? "Director (optional)" : "Author (optional)"}><Input value={f.creator ?? ""} onChange={(e) => setF({ ...f, creator: e.target.value })} /></Field>
        <Field label="Recommended by"><Input value={f.recommended_by ?? ""} onChange={(e) => setF({ ...f, recommended_by: e.target.value })} /></Field>
        <Field label="Notes"><Textarea value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-16" /></Field>
        <div className="flex gap-2">
          <Button type="button" variant="danger" onClick={() => setDel(true)}><Trash2 className="size-4" /></Button>
          <Button size="lg" type="submit" className="flex-1">Save</Button>
        </div>
      </form>
      <Confirm open={del} title="Delete from list?" onClose={() => setDel(false)} onConfirm={async () => { if (!item) return; const { error } = await supabase.from("recommendations").delete().eq("id", item.id); if (error) toast(errMsg(error), "err"); else { onSaved(); onClose(); } }} />
    </Sheet>
  );
}
