import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@^2.0.0";
import { pipeline } from "npm:@supabase/middleware@1";
import { withOAuthProtectedResource, withSupabase } from "npm:@supabase/server@1";
import { z } from "npm:zod@^4.3.6";

type DbError = { message: string } | null;

function failOnError(error: DbError) {
  if (error) throw new Error(error.message);
}

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function indiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysBefore(day: string, days: number) {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional();

Deno.serve(
  pipeline(
    [
      // Publish OAuth discovery before the auth check, then create an RLS-scoped
      // Supabase client from the signed-in user's OAuth access token.
      withOAuthProtectedResource(),
      withSupabase({ auth: "user" }),
    ],
    async (req, { supabase }) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer({
          name: "AMAN OS",
          version: "1.0.0",
        });

        server.registerTool(
          "get_aor_overview",
          {
            title: "AOR study overview",
            description:
              "Read the signed-in user's AOR judgment progress and revision counts. Returns aggregate counts only, not judgment notes or legal documents.",
            inputSchema: z.object({ as_of: dateSchema }),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          async ({ as_of }) => {
            const day = as_of ?? indiaToday();
            const [profileResult, totalResult, notStartedResult, readingResult, firstReadResult, firstRevisionResult, secondRevisionResult, recallResult, dueResult, difficultResult] =
              await Promise.all([
                supabase.from("profiles").select("aor_exam_date,aor_daily_target_judgments,aor_weekly_target_judgments").maybeSingle(),
                supabase.from("judgments").select("id", { count: "exact", head: true }),
                supabase.from("judgments").select("id", { count: "exact", head: true }).eq("status", "not_started"),
                supabase.from("judgments").select("id", { count: "exact", head: true }).eq("status", "reading"),
                supabase.from("judgments").select("id", { count: "exact", head: true }).eq("status", "first_reading_completed"),
                supabase.from("judgments").select("id", { count: "exact", head: true }).eq("status", "first_revision_completed"),
                supabase.from("judgments").select("id", { count: "exact", head: true }).eq("status", "second_revision_completed"),
                supabase.from("judgments").select("id", { count: "exact", head: true }).eq("status", "recall_test_completed"),
                supabase.from("judgments").select("id", { count: "exact", head: true }).lte("next_review_date", day),
                supabase.from("judgments").select("id", { count: "exact", head: true }).eq("is_difficult", true),
              ]);

            const results = [profileResult, totalResult, notStartedResult, readingResult, firstReadResult, firstRevisionResult, secondRevisionResult, recallResult, dueResult, difficultResult];
            for (const result of results) failOnError(result.error);

            return jsonResult({
              as_of: day,
              exam_date: profileResult.data?.aor_exam_date ?? null,
              daily_target: profileResult.data?.aor_daily_target_judgments ?? null,
              weekly_target: profileResult.data?.aor_weekly_target_judgments ?? null,
              total_judgments: totalResult.count ?? 0,
              by_status: {
                not_started: notStartedResult.count ?? 0,
                reading: readingResult.count ?? 0,
                first_reading_completed: firstReadResult.count ?? 0,
                first_revision_completed: firstRevisionResult.count ?? 0,
                second_revision_completed: secondRevisionResult.count ?? 0,
                recall_test_completed: recallResult.count ?? 0,
              },
              due_for_review: dueResult.count ?? 0,
              marked_difficult: difficultResult.count ?? 0,
            });
          },
        );

        server.registerTool(
          "list_due_aor_reviews",
          {
            title: "List AOR revisions due",
            description:
              "List AOR judgments due for review. Returns case title, citation and study metadata only; it deliberately excludes personal notes, facts, legal documents and diary content.",
            inputSchema: z.object({
              as_of: dateSchema,
              limit: z.number().int().min(1).max(50).default(20),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          async ({ as_of, limit }) => {
            const day = as_of ?? indiaToday();
            const { data, error } = await supabase
              .from("judgments")
              .select("id,case_name,citation,court,year,topic,status,next_review_date,is_difficult,confidence")
              .lte("next_review_date", day)
              .order("next_review_date", { ascending: true })
              .limit(limit);
            failOnError(error);
            return jsonResult({ as_of: day, count: data?.length ?? 0, reviews: data ?? [] });
          },
        );

        server.registerTool(
          "get_hyrox_progress",
          {
            title: "HYROX training progress",
            description:
              "Read upcoming HYROX event information and recent training-session summaries. Session notes and unrelated personal records are not returned.",
            inputSchema: z.object({
              recent_sessions: z.number().int().min(1).max(20).default(10),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          async ({ recent_sessions }) => {
            const [eventsResult, sessionsResult, personalBestsResult] = await Promise.all([
              supabase
                .from("hyrox_events")
                .select("name,event_date,location,division_code,goal_time_seconds,status,result_total_seconds")
                .order("event_date", { ascending: true })
                .limit(5),
              supabase
                .from("hyrox_sessions")
                .select("title,session_type,planned_date,completed_at,status,total_seconds,avg_hr,rpe,fatigue")
                .order("planned_date", { ascending: false })
                .limit(recent_sessions),
              supabase
                .from("hyrox_station_pbs")
                .select("station,time_seconds,weight_kg,performed_on")
                .order("performed_on", { ascending: false })
                .limit(12),
            ]);
            failOnError(eventsResult.error);
            failOnError(sessionsResult.error);
            failOnError(personalBestsResult.error);
            return jsonResult({
              events: eventsResult.data ?? [],
              recent_sessions: sessionsResult.data ?? [],
              station_personal_bests: personalBestsResult.data ?? [],
            });
          },
        );

        server.registerTool(
          "get_fitness_summary",
          {
            title: "Fitness and activity summary",
            description:
              "Read recent activity, workout summaries and the latest weight measurements for the signed-in user. Does not return raw Garmin files or private workout notes.",
            inputSchema: z.object({
              as_of: dateSchema,
              activity_days: z.number().int().min(1).max(14).default(7),
              workout_days: z.number().int().min(1).max(30).default(14),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          async ({ as_of, activity_days, workout_days }) => {
            const day = as_of ?? indiaToday();
            const activityFrom = daysBefore(day, activity_days - 1);
            const workoutFrom = daysBefore(day, workout_days - 1);
            const [activityResult, workoutsResult, weightResult] = await Promise.all([
              supabase
                .from("daily_activity")
                .select("day,steps,active_kcal,resting_hr,sleep_minutes,sleep_score,hrv_ms,body_battery,training_readiness,stress_avg")
                .gte("day", activityFrom)
                .lte("day", day)
                .order("day", { ascending: true })
                .limit(30),
              supabase
                .from("workouts")
                .select("type,title,started_at,duration_seconds,distance_m,avg_pace_s_per_km,avg_hr,calories_kcal,elevation_gain_m,rpe")
                .gte("started_at", `${workoutFrom}T00:00:00.000Z`)
                .order("started_at", { ascending: false })
                .limit(50),
              supabase
                .from("weight_records")
                .select("measured_on,weight_kg,waist_cm")
                .order("measured_on", { ascending: false })
                .limit(5),
            ]);
            failOnError(activityResult.error);
            failOnError(workoutsResult.error);
            failOnError(weightResult.error);
            return jsonResult({
              as_of: day,
              activity: activityResult.data ?? [],
              workouts: workoutsResult.data ?? [],
              latest_body_measurements: weightResult.data ?? [],
            });
          },
        );

        server.registerTool(
          "get_nutrition_summary",
          {
            title: "Nutrition summary",
            description:
              "Read daily calorie and macronutrient totals for the signed-in user over a limited date range. Does not expose individual food diary entries.",
            inputSchema: z.object({
              as_of: dateSchema,
              days: z.number().int().min(1).max(14).default(7),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          async ({ as_of, days }) => {
            const day = as_of ?? indiaToday();
            const from = daysBefore(day, days - 1);
            const { data, error } = await supabase
              .from("daily_nutrition")
              .select("day,calories_kcal,protein_g,carbs_g,fat_g,calorie_target_kcal,protein_target_g,calories_remaining")
              .gte("day", from)
              .lte("day", day)
              .order("day", { ascending: true })
              .limit(14);
            failOnError(error);
            return jsonResult({ from, to: day, days: data ?? [] });
          },
        );

        return server;
      });

      return handler.fetch(req);
    },
  ),
);
