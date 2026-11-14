"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, ExternalLink, Search } from "lucide-react";
import { Card, Badge, Input, Empty, ListRow } from "@/components/ui";
import { LEADING_CASES } from "./leading-cases";
import { STATUSES, statusIdx, type Judgment } from "./types";

// AOR Exam Master Briefs, served from /public/briefs. Keyed by the case's number in the official List of Leading Cases.
export const BRIEFS: Record<number, string> = {
  1: "01-kesavananda-bharati.html", 2: "02-maneka-gandhi.html", 3: "03-minerva-mills.html", 4: "04-sharad-sarda.html",
  5: "05-ar-antulay.html", 6: "06-kihoto-hollohan.html", 7: "07-indra-sawhney.html", 8: "08-sr-bommai.html",
  9: "09-l-chandra-kumar.html", 10: "10-vellore-citizens.html", 11: "11-dk-basu.html", 12: "12-mafatlal-industries.html",
  13: "13-vishaka.html", 14: "14-githa-hariharan.html", 15: "15-rupa-ashok-hurra.html",
};

export type Brief = { no: number; case_name: string; citation: string; url: string };

const norm = (x?: string | null) => (x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const byCitation = new Map(LEADING_CASES.map((c) => [norm(c.citation), c]));
const byName = new Map(LEADING_CASES.map((c) => [norm(c.case_name), c]));

/** The case's number in the official List of Leading Cases, if it is on the list. */
export function leadingNoFor(j: Pick<Judgment, "case_name" | "citation"> | null | undefined): number | null {
  if (!j) return null;
  return (byCitation.get(norm(j.citation)) ?? byName.get(norm(j.case_name)))?.no ?? null;
}

export function briefFor(j: Pick<Judgment, "case_name" | "citation"> | null | undefined): Brief | null {
  if (!j) return null;
  const c = byCitation.get(norm(j.citation)) ?? byName.get(norm(j.case_name));
  if (!c || !BRIEFS[c.no]) return null;
  return { no: c.no, case_name: c.case_name, citation: c.citation, url: `/briefs/${BRIEFS[c.no]}` };
}

export const ALL_BRIEFS: Brief[] = LEADING_CASES.filter((c) => BRIEFS[c.no]).map((c) => ({ no: c.no, case_name: c.case_name, citation: c.citation, url: `/briefs/${BRIEFS[c.no]}` }));

/** Full-screen reader for a brief, inside the app. */
export function BriefViewer({ brief, onClose }: { brief: Brief | null; onClose: () => void }) {
  useEffect(() => {
    if (!brief) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = o; };
  }, [brief, onClose]);
  if (!brief) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg anim-fade" role="dialog" aria-modal="true" aria-label={`Master brief: ${brief.case_name}`}>
      <div className="flex items-center gap-2 px-2 pt-[calc(env(safe-area-inset-top)+6px)] pb-2 border-b border-line-soft bg-surface">
        <button onClick={onClose} className="h-10 px-2 rounded-lg flex items-center gap-1 text-ink-2 hover:bg-surface-2 shrink-0" aria-label="Back"><ArrowLeft className="size-5" /><span className="text-sm font-medium">Back</span></button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-sm font-semibold truncate">{brief.no}. {brief.case_name}</div>
          <div className="text-[11px] text-ink-3 truncate">AOR Exam Master Brief</div>
        </div>
        <a href={brief.url} target="_blank" rel="noopener" className="size-10 grid place-items-center rounded-lg text-ink-2 hover:bg-surface-2 shrink-0" aria-label="Open in new tab"><ExternalLink className="size-5" /></a>
      </div>
      <iframe key={brief.url} src={brief.url} title={brief.case_name} className="flex-1 w-full bg-white border-0" />
    </div>
  );
}

/** List of every brief, with the matching judgment's progress. */
export function Briefs({ judgments, onOpen }: { judgments: Judgment[]; onOpen: (b: Brief) => void }) {
  const [q, setQ] = useState("");
  const statusOf = useMemo(() => {
    const m = new Map<number, Judgment>();
    judgments.forEach((j) => { const b = briefFor(j); if (b) m.set(b.no, j); });
    return m;
  }, [judgments]);
  const list = ALL_BRIEFS.filter((b) => !q.trim() || norm(b.case_name).includes(norm(q)));
  return (
    <div className="grid gap-3 lg:gap-4 grid-cols-1 lg:grid-cols-3">
      <Card pad={false} className="lg:col-span-2 min-w-0" title={`Master briefs · ${ALL_BRIEFS.length} of ${LEADING_CASES.length} leading cases`}>
        <div className="px-4 pb-3 lg:px-5 relative"><Search className="size-4 absolute left-7 lg:left-8 top-3.5 text-ink-3" /><Input className="pl-9" placeholder="Search briefs" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {list.length ? list.map((b) => {
          const j = statusOf.get(b.no);
          return (
            <ListRow key={b.no} onClick={() => onOpen(b)} right={j ? <Badge tone={statusIdx(j.status) >= 2 ? "accent" : "neutral"}>{STATUSES[statusIdx(j.status)].short}</Badge> : undefined}>
              <div className="flex items-center gap-2 min-w-0"><BookOpen className="size-4 text-accent shrink-0" /><span className="font-medium truncate"><span className="text-ink-3 tabular mr-1">{b.no}.</span>{b.case_name}</span></div>
              <div className="text-xs text-ink-3 truncate pl-6">{b.citation}</div>
            </ListRow>
          );
        }) : <Empty title="No briefs match" />}
      </Card>
      <Card title="How to use">
        <ul className="text-sm text-ink-2 space-y-2 list-disc pl-4">
          <li>Tap a case to read its full brief inside MYOS.</li>
          <li>The same brief opens from the judgment itself (Judgments or Checklist tab).</li>
          <li>Once opened, a brief stays saved on this device, so it opens without internet next time.</li>
        </ul>
      </Card>
    </div>
  );
}
