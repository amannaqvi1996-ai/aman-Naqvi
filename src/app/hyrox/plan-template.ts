import { addDays, weekStart, daysBetween } from "@/lib/format";
import { HYROX_DATE } from "@/lib/hyrox";

/**
 * A conservative periodised template from the current week to race week.
 * It is a starting point only — every week and session is editable, and the
 * app never raises load automatically.
 */
type PlanSession = { offset: number; session_type: string; title: string; prescription: string };
type Week = { week_start: string; phase: string; focus: string; planned_run_km: number; sessions: PlanSession[] };

const BASE: Record<string, { focus: string; km: number; sessions: PlanSession[] }> = {
  build: {
    focus: "Aerobic base, functional strength, station technique",
    km: 22,
    sessions: [
      { offset: 1, session_type: "running_intervals", title: "Run intervals", prescription: "Warm-up 10 min · 6 × 1 km at goal race pace, 90 s jog · cool-down" },
      { offset: 2, session_type: "strength", title: "Functional strength", prescription: "Squat, deadlift, lunges, pulls · 4 × 6–8 moderate · sled push/pull technique" },
      { offset: 3, session_type: "station_specific", title: "Stations: SkiErg, row, wall balls", prescription: "3 rounds: 500 m SkiErg · 500 m row · 30 wall balls · steady effort" },
      { offset: 5, session_type: "long_run", title: "Long easy run", prescription: "60–75 min conversational pace" },
    ],
  },
  specific: {
    focus: "Running under fatigue, race-weight stations, compromised running",
    km: 26,
    sessions: [
      { offset: 1, session_type: "running_under_fatigue", title: "Compromised running", prescription: "4 rounds: 1 km run at race pace + one station at race weight" },
      { offset: 2, session_type: "strength", title: "Strength + sleds", prescription: "Heavy sled push/pull 4 × 25 m · farmers carry 4 × 50 m · lunges" },
      { offset: 3, session_type: "station_specific", title: "Burpee broad jumps + lunges + wall balls", prescription: "3 × (40 m BBJ · 50 m sandbag lunges · 50 wall balls)" },
      { offset: 5, session_type: "half_simulation", title: "Half simulation", prescription: "4 × 1 km + stations 1–4 at race weight, record splits" },
    ],
  },
  peak: {
    focus: "Full race rehearsal and pacing",
    km: 24,
    sessions: [
      { offset: 1, session_type: "running_intervals", title: "Race-pace kilometres", prescription: "5 × 1 km at goal pace, 2 min easy" },
      { offset: 3, session_type: "station_specific", title: "Station sharpening", prescription: "Short, crisp efforts on weakest stations" },
      { offset: 5, session_type: "full_simulation", title: "Full simulation", prescription: "8 × 1 km + all 8 stations at race standard, record every split" },
    ],
  },
  taper: {
    focus: "Reduce volume, keep intensity, sleep and recover",
    km: 14,
    sessions: [
      { offset: 1, session_type: "running_intervals", title: "Short sharpener", prescription: "4 × 500 m at race pace" },
      { offset: 3, session_type: "station_specific", title: "Light stations", prescription: "1 round of each station at easy effort, technique only" },
      { offset: 5, session_type: "recovery", title: "Recovery", prescription: "Easy 30 min + mobility" },
    ],
  },
  race: {
    focus: "Race week",
    km: 6,
    sessions: [{ offset: 0, session_type: "full_simulation", title: "HYROX race day", prescription: "Race. Pace run 1 conservatively." }],
  },
};

export function buildPlan(today: string): Week[] {
  const raceWeek = weekStart(HYROX_DATE);
  const weeks: Week[] = [];
  for (let w = weekStart(today); w <= raceWeek; w = addDays(w, 7)) {
    const toRace = daysBetween(w, raceWeek) / 7;
    const phase = toRace === 0 ? "race" : toRace === 1 ? "taper" : toRace === 2 ? "peak" : toRace <= 6 ? "specific" : "build";
    const b = BASE[phase];
    // every 4th build/specific week is a lighter week
    const idx = weeks.filter((x) => x.phase === phase).length;
    const deload = (phase === "build" || phase === "specific") && idx % 4 === 3;
    weeks.push({
      week_start: w, phase, focus: deload ? `${b.focus} (lighter week)` : b.focus,
      planned_run_km: deload ? Math.round(b.km * 0.7) : b.km,
      sessions: b.sessions.filter((s) => addDays(w, s.offset) >= today && addDays(w, s.offset) <= HYROX_DATE),
    });
  }
  return weeks;
}
