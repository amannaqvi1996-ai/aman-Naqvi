export type Subject = { id: string; name: string; sort_order: number };
export type JStatus = "not_started" | "reading" | "first_reading_completed" | "first_revision_completed" | "second_revision_completed" | "recall_test_completed";
export type Judgment = {
  id: string; subject_id: string | null; case_name: string; citation: string | null; court: string | null; year: number | null;
  topic: string | null; facts: string | null; issues: string | null; ratio_decidendi: string | null; obiter_dicta: string | null;
  important_paragraphs: string | null; statutory_provisions: string | null; personal_notes: string | null;
  status: JStatus; first_reading_date: string | null; confidence: number | null; is_difficult: boolean;
  next_review_date: string | null; sr_interval_days: number; sr_repetitions: number; updated_at: string;
};
export const STATUSES: { value: JStatus; label: string; short: string }[] = [
  { value: "not_started", label: "Not started", short: "New" },
  { value: "reading", label: "Reading", short: "Reading" },
  { value: "first_reading_completed", label: "First reading completed", short: "Read" },
  { value: "first_revision_completed", label: "First revision completed", short: "Rev 1" },
  { value: "second_revision_completed", label: "Second revision completed", short: "Rev 2" },
  { value: "recall_test_completed", label: "Recall test completed", short: "Recall ✓" },
];
export const statusIdx = (s: JStatus) => STATUSES.findIndex((x) => x.value === s);
export const statusLabel = (s: JStatus) => STATUSES.find((x) => x.value === s)?.label ?? s;
