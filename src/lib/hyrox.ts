import { supabase } from "./supabase";

export const HYROX_DATE = "2027-01-18";
export const DEFAULT_DIVISION = "men_open";

export type HyroxEvent = {
  id: string; name: string; event_date: string; location: string | null; division_code: string | null;
  goal_time_seconds: number | null; status: "upcoming" | "completed" | "dns" | "dnf";
  result_total_seconds: number | null; result_roxzone_seconds: number | null; result_rank_overall: number | null;
  result_rank_age_group: number | null; result_notes: string | null; completed_at: string | null;
};

/** Ensures the 18 Jan 2027 race exists for this user; returns it. */
export async function ensureHyroxEvent(): Promise<HyroxEvent> {
  const { data, error } = await supabase.from("hyrox_events").select("*").eq("event_date", HYROX_DATE).maybeSingle();
  if (error) throw error;
  if (data) return data as HyroxEvent;
  const ins = await supabase.from("hyrox_events")
    .insert({ name: "HYROX", event_date: HYROX_DATE, division_code: DEFAULT_DIVISION })
    .select("*").single();
  if (ins.error) {
    // another device created it at the same moment
    const again = await supabase.from("hyrox_events").select("*").eq("event_date", HYROX_DATE).maybeSingle();
    if (again.data) return again.data as HyroxEvent;
    throw ins.error;
  }
  return ins.data as HyroxEvent;
}

export const SESSION_TYPES: { value: string; label: string }[] = [
  { value: "running_intervals", label: "Running intervals" },
  { value: "running_under_fatigue", label: "Running under fatigue" },
  { value: "long_run", label: "Long run" },
  { value: "station_specific", label: "Station-specific" },
  { value: "half_simulation", label: "Half simulation" },
  { value: "full_simulation", label: "Full simulation" },
  { value: "strength", label: "Strength" },
  { value: "conditioning", label: "Conditioning" },
  { value: "recovery", label: "Recovery" },
];
export const sessionLabel = (v: string) => SESSION_TYPES.find((s) => s.value === v)?.label ?? v;

export const PHASES = ["base", "build", "specific", "peak", "taper", "race", "recovery"] as const;
