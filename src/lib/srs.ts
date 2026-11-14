// Spaced-repetition scheduling for flashcards (an SM-2 variant, close to Anki's).
export type Grade = "again" | "hard" | "good" | "easy";
export type SrsState = { ease: number; interval_days: number; repetitions: number; lapses: number };

const MIN_EASE = 1.3;

/** Returns the card's next state after a review. interval_days 0 = see again today. */
export function schedule(s: SrsState, g: Grade): SrsState {
  const ease = Number(s.ease) || 2.5;
  const prev = s.interval_days;
  if (g === "again") return { ease: Math.max(MIN_EASE, ease - 0.2), interval_days: 0, repetitions: 0, lapses: s.lapses + 1 };
  if (g === "hard") {
    // A brand-new card marked Hard comes back later in the same session.
    if (s.repetitions === 0) return { ease, interval_days: 0, repetitions: 0, lapses: s.lapses };
    const iv = Math.max(prev + 1, Math.round(prev * 1.2));
    return { ease: Math.max(MIN_EASE, ease - 0.15), interval_days: iv, repetitions: s.repetitions + 1, lapses: s.lapses };
  }
  if (g === "good") {
    const iv = s.repetitions === 0 ? 1 : s.repetitions === 1 ? 3 : Math.max(prev + 1, Math.round(prev * ease));
    return { ease, interval_days: iv, repetitions: s.repetitions + 1, lapses: s.lapses };
  }
  const iv = s.repetitions === 0 ? 4 : Math.max(prev + 2, Math.round(prev * ease * 1.3));
  return { ease: ease + 0.15, interval_days: iv, repetitions: s.repetitions + 1, lapses: s.lapses };
}

export function intervalLabel(days: number): string {
  if (days <= 0) return "<10m";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Turns Anki-style HTML into plain text with line breaks. */
export function htmlToText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export type Confidence = "green" | "yellow" | "red";
/** Pulls a 🟢/🟡/🔴 tag out of the answer text. */
export function extractConfidence(text: string): { text: string; confidence: Confidence | null } {
  const map: [string, Confidence][] = [["🟢", "green"], ["🟡", "yellow"], ["🔴", "red"]];
  let confidence: Confidence | null = null;
  let out = text;
  for (const [emoji, c] of map) if (out.includes(emoji)) { confidence ??= c; out = out.split(emoji).join(""); }
  return { text: out.replace(/[ \t]+\n/g, "\n").trim(), confidence };
}

export type ParsedCard = { front: string; back: string; tags: string[]; confidence: Confidence | null };
/** Parses an Anki text export / tab-separated file: front<TAB>back[<TAB>tags]. */
export function parseCardFile(raw: string): { cards: ParsedCard[]; problems: string[] } {
  let sep = "\t"; let tagCol = -1;
  const cards: ParsedCard[] = []; const problems: string[] = [];
  raw.replace(/^﻿/, "").split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    if (line.startsWith("#")) {
      const m = line.match(/^#(\w+):(.*)$/);
      if (m?.[1] === "separator") { const v = m[2].trim().toLowerCase(); sep = v === "tab" ? "\t" : v === "comma" ? "," : v === "semicolon" ? ";" : v === "pipe" ? "|" : v || "\t"; }
      if (m?.[1] === "tags column") tagCol = Number(m[2]) - 1;
      return;
    }
    const cols = line.split(sep);
    if (cols.length < 2) { problems.push(`Line ${i + 1}: no answer found — skipped`); return; }
    const front = htmlToText(cols[0]);
    const { text: back, confidence } = extractConfidence(htmlToText(cols[1]));
    const tagStr = tagCol >= 0 ? cols[tagCol] : cols[2];
    if (!front) { problems.push(`Line ${i + 1}: empty question — skipped`); return; }
    cards.push({ front, back, confidence, tags: (tagStr ?? "").split(/\s+/).filter(Boolean) });
  });
  return { cards, problems };
}
