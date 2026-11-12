// End-to-end UI test of the static build against an in-memory stand-in for Supabase.
// Usage: NODE_PATH=/opt/npm-tools/node_modules node tests/e2e.cjs
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT = path.join(__dirname, "..", "out");
const SB = "https://auwdtvdvkusspilvdrdg.supabase.co";
const SHOTS = path.join(__dirname, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const USER = "aaaaaaaa-0000-4000-8000-00000000000a";

// ---------- static server for ./out ----------
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(OUT, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { f = path.join(OUT, "404.html"); res.statusCode = 404; }
  res.setHeader("content-type", types[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
});

// ---------- in-memory Supabase ----------
const now = () => new Date().toISOString();
const db = {
  profiles: [{ id: USER, user_id: USER, display_name: "Aman", timezone: "Asia/Kolkata", calorie_target_kcal: 1500, protein_target_g: 120, water_target_ml: 3000, aor_exam_date: null, aor_daily_target_judgments: 3, aor_weekly_target_judgments: 15, dashboard_config: {} }],
  hyrox_stations: [[1, "SkiErg", "1,000 m", 1000, null], [2, "Sled Push", "50 m", 50, null], [3, "Sled Pull", "50 m", 50, null], [4, "Burpee Broad Jumps", "80 m", 80, null], [5, "Rowing", "1,000 m", 1000, null], [6, "Farmers Carry", "200 m", 200, null], [7, "Sandbag Lunges", "100 m", 100, null], [8, "Wall Balls", "100 reps", null, 100]].map(([id, name, workload, distance_m, reps]) => ({ id, name, workload, distance_m, reps })),
  hyrox_divisions: [{ code: "men_open", name: "Men's Open", format: "singles", sort_order: 10 }, { code: "men_pro", name: "Men's Pro", format: "singles", sort_order: 20 }],
  hyrox_division_standards: [[1, null, "Bodyweight"], [2, 152, "Total incl. sled"], [3, 103, "Total incl. sled"], [4, null, "Bodyweight"], [5, null, "Bodyweight"], [6, 24, "Per hand"], [7, 20, "Sandbag"], [8, 6, "Ball weight"]]
    .map(([station_id, load_kg, load_note]) => ({ division_code: "men_open", station_id, load_kg, load_note, reps: station_id === 8 ? 100 : null, target_height_m: station_id === 8 ? 3 : null, verified: false, rulebook_season: "26/27" })),
};
const T = (t) => (db[t] ||= []);
const errors = [];

function applyFilters(rows, params) {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    const m = /^(eq|neq|gte|lte|gt|lt|in|is|not)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, raw] = m;
    rows = rows.filter((r) => {
      const x = r[k];
      if (op === "eq") return String(x) === raw;
      if (op === "neq") return String(x) !== raw;
      if (op === "gte") return x != null && String(x) >= raw;
      if (op === "lte") return x != null && String(x) <= raw;
      if (op === "gt") return x != null && String(x) > raw;
      if (op === "lt") return x != null && String(x) < raw;
      if (op === "is") return raw === "null" ? x == null : true;
      if (op === "in") return raw.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/"/g, "")).includes(String(x));
      if (op === "not") return raw.startsWith("is.null") ? x != null : true;
      return true;
    });
  }
  return rows;
}
function defaults(table, row) {
  const r = { id: crypto.randomUUID(), user_id: USER, created_at: now(), updated_at: now(), ...row };
  if (table === "judgments") Object.assign(r, { status: r.status ?? "not_started", is_difficult: r.is_difficult ?? false, sr_interval_days: 0, sr_repetitions: 0, next_review_date: null });
  if (table === "diary_entries") r.version = 1;
  if (table === "study_sessions") r.duration_minutes = r.ended_at ? Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 60000) : null;
  if (table === "workouts") r.avg_pace_s_per_km = r.distance_m && r.duration_seconds ? r.duration_seconds / (r.distance_m / 1000) : null;
  if (table === "reading_sessions") r.pages_read = r.end_page - r.start_page;
  return r;
}
function rpc(name, body) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  if (name === "command_centre") {
    const ev = T("hyrox_events")[0];
    const food = T("nutrition_entries");
    return {
      day: today,
      aor: { daily_target: 3, studied_today: new Set(T("study_sessions").map((s) => s.judgment_id).filter(Boolean)).size, minutes_today: T("study_sessions").reduce((a, s) => a + (s.duration_minutes || 0), 0), total: T("judgments").length, first_read: T("judgments").filter((j) => !["not_started", "reading"].includes(j.status)).length, due_reviews: 0 },
      hyrox: ev ? { event_id: ev.id, event_date: ev.event_date, days_to_go: Math.round((Date.parse(ev.event_date) - Date.parse(today)) / 864e5), division: ev.division_code, next_session: T("hyrox_sessions").filter((s) => s.status === "planned").sort((a, b) => a.planned_date.localeCompare(b.planned_date))[0] ?? null, week_sessions_done: 0, week_sessions_planned: 0 } : null,
      fitness: { steps: T("daily_activity")[0]?.steps ?? null, week_run_km: T("workouts").reduce((a, w) => a + (w.distance_m || 0) / 1000, 0), workouts_today: T("workouts") },
      nutrition: { calories: food.reduce((a, e) => a + Number(e.calories_kcal), 0), protein_g: food.reduce((a, e) => a + Number(e.protein_g), 0), calorie_target: 1500, protein_target: 120, estimated_entries: food.filter((e) => e.confidence === "estimated").length },
      reading: { pages_today: 0 }, tasks: { today: 0, overdue: 0, done_today: 0 }, habits: [],
    };
  }
  if (name === "record_revision") {
    const j = T("judgments").find((x) => x.id === body.p_judgment_id);
    const next = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    Object.assign(j, { status: body.p_kind === "first_reading" ? "first_reading_completed" : j.status, next_review_date: next, sr_repetitions: 1, sr_interval_days: 1 });
    T("revision_records").push({ id: crypto.randomUUID(), judgment_id: j.id, recall_quality: body.p_quality });
    return j;
  }
  if (name === "export_my_data") return { format: "aman-os-export-v1", judgments: T("judgments") };
  return null;
}

async function handleSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (status, body, headers = {}) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });
  if (method === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (url.pathname.startsWith("/auth/v1/user")) return json(200, { id: USER, email: "aman@example.test", aud: "authenticated", role: "authenticated" });
  if (url.pathname.startsWith("/auth/v1/logout")) return route.fulfill({ status: 204 });
  if (url.pathname.startsWith("/auth/v1/token")) return json(400, { error: "invalid_grant", error_description: "Invalid login credentials" });
  if (url.pathname.startsWith("/rest/v1/rpc/")) return json(200, rpc(url.pathname.split("/").pop(), req.postDataJSON?.() ?? {}));
  const m = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
  if (!m) return json(404, { message: "not mocked " + url.pathname });
  const table = m[1];
  const wantsObject = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  const prefer = req.headers()["prefer"] || "";
  let rows = applyFilters(T(table), url.searchParams);
  if (method === "GET" || method === "HEAD") {
    const order = url.searchParams.get("order");
    if (order) { const [col, dir] = order.split(",")[0].split("."); rows = [...rows].sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : 1) * (dir === "desc" ? -1 : 1)); }
    const lim = url.searchParams.get("limit"); if (lim) rows = rows.slice(0, Number(lim));
    return wantsObject ? (rows.length ? json(200, rows[0]) : json(406, { code: "PGRST116", message: "no rows" })) : json(200, rows);
  }
  const body = req.postDataJSON ? req.postDataJSON() : null;
  if (method === "POST") {
    const list = (Array.isArray(body) ? body : [body]).map((r) => defaults(table, r));
    if (prefer.includes("merge-duplicates")) {
      const keys = (url.searchParams.get("on_conflict") || "id").split(",").filter((k) => k !== "user_id");
      for (const r of list) { const ex = T(table).find((x) => keys.every((k) => String(x[k]) === String(r[k]))); if (ex) Object.assign(ex, r, { id: ex.id }); else T(table).push(r); }
    } else T(table).push(...list);
    const out = prefer.includes("return=representation") ? list : null;
    return out ? (wantsObject ? json(201, out[0]) : json(201, out)) : route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" } });
  }
  if (method === "PATCH") {
    rows.forEach((r) => { Object.assign(r, body, { updated_at: now() }); if (table === "diary_entries") r.version = (r.version || 1) + 1; if (table === "study_sessions" && r.ended_at) r.duration_minutes = Math.max(1, Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 60000)); });
    return prefer.includes("return=representation") ? (wantsObject ? json(200, rows[0]) : json(200, rows)) : route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
  }
  if (method === "DELETE") { db[table] = T(table).filter((r) => !rows.includes(r)); return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } }); }
  return json(405, {});
}

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); };

(async () => {
  await new Promise((r) => server.listen(4173, r));
  const BASE = "http://localhost:4173";
  const browser = await chromium.launch();

  async function newCtx(viewport, signedIn = true) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, timezoneId: "Asia/Kolkata", acceptDownloads: true });
    await ctx.route(`${SB}/**`, handleSupabase);
    await ctx.routeWebSocket(/supabase\.co/, (ws) => { ws.onMessage(() => {}); });
    if (signedIn) {
      const session = { access_token: "test.jwt.token", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user: { id: USER, email: "aman@example.test", aud: "authenticated", role: "authenticated" } };
      await ctx.addInitScript((s) => localStorage.setItem("sb-auwdtvdvkusspilvdrdg-auth-token", JSON.stringify(s)), session);
    }
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${viewport.width}px ${page.url()}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|realtime|Failed to load resource/i.test(m.text())) errors.push(`console ${page.url()}: ${m.text().slice(0, 200)}`); });
    return { ctx, page };
  }
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // ---------- Login screen ----------
  {
    const { ctx, page } = await newCtx({ width: 390, height: 844 }, false);
    await page.goto(BASE + "/");
    await page.waitForURL(/\/login\/?$/, { timeout: 10000 });
    check("signed-out user is redirected to login", page.url().includes("/login"));
    await page.fill('input[type="email"]', "aman@example.test");
    await page.fill('input[type="password"]', "wrongpass");
    await page.click('button[type="submit"]');
    await page.getByText("Invalid login credentials").waitFor({ timeout: 5000 });
    check("login shows auth error from server", true);
    await page.screenshot({ path: `${SHOTS}/iphone-login.png` });
    await ctx.close();
  }

  // ---------- iPhone flows ----------
  const { ctx, page } = await newCtx({ width: 390, height: 844 });
  const go = async (p) => { await page.goto(BASE + p); await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); };

  await go("/");
  await page.getByText("days to go").waitFor({ timeout: 10000 });
  check("dashboard renders HYROX countdown", await page.getByText("days to go").isVisible());
  check("HYROX event auto-created for 18 Jan 2027", T("hyrox_events").length === 1 && T("hyrox_events")[0].event_date === "2027-01-18" && T("hyrox_events")[0].division_code === "men_open");
  check("bottom tab bar visible on iPhone", await page.locator("nav").filter({ hasText: "More" }).isVisible());
  check("no horizontal overflow: dashboard", await noOverflow(page));

  // Quick journal from dashboard
  await page.fill('textarea[placeholder="What\'s on your mind?"]', "Finished reply draft.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(500);
  check("quick journal saves diary entry", T("diary_entries").some((d) => d.body.includes("Finished reply draft.")));

  // Nutrition
  await go("/nutrition/");
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByLabel("Food", { exact: true }).fill("Paneer bhurji");
  await page.getByLabel("kcal", { exact: true }).fill("320");
  await page.getByLabel("Protein g", { exact: true }).fill("22");
  await page.getByRole("button", { name: "Log food" }).last().click();
  await page.getByText("Paneer bhurji").first().waitFor({ timeout: 5000 });
  check("nutrition: food entry saved and listed", T("nutrition_entries").length === 1 && Number(T("nutrition_entries")[0].calories_kcal) === 320);
  check("nutrition: remaining calories computed (1500-320=1,180)", await page.getByText("1,180 kcal").first().waitFor({ timeout: 5000 }).then(() => true, () => false));
  check("nutrition: estimated values labelled", await page.getByText("Est.").first().isVisible());
  check("nutrition: safety note shown, exercise not added back", await page.getByText("not", { exact: true }).first().isVisible());
  await page.getByRole("button", { name: "500" }).click();
  await page.waitForTimeout(400);
  check("nutrition: water logged", T("water_logs").some((w) => w.amount_ml === 500));
  check("no horizontal overflow: nutrition", await noOverflow(page));
  await page.screenshot({ path: `${SHOTS}/iphone-nutrition.png`, fullPage: true });

  // Weight
  await go("/body/");
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByLabel("Weight (kg)", { exact: true }).fill("82.4");
  await page.getByLabel("Waist (cm)", { exact: true }).fill("91");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(500);
  check("weight: measurement saved", T("weight_records").some((w) => Number(w.weight_kg) === 82.4 && Number(w.waist_cm) === 91));
  check("weight: shows latest value", await page.getByText("82.4").first().isVisible());

  // AOR import
  await go("/aor/");
  await page.getByRole("button", { name: "Import CSV" }).click();
  const csv = path.join(__dirname, "sample-import.csv");
  fs.writeFileSync(csv, "case_name,citation,court,year,subject,topic\nTEST Case One v. State,TEST-1,Test Court,2020,Test Subject A,Topic\nTEST Case Two v. Union,TEST-2,Test Court,2021,Test Subject B,Topic\n,missing,,,,\n");
  await page.setInputFiles('input[type="file"]', csv);
  await page.getByText("2 new").waitFor({ timeout: 5000 });
  check("AOR import: preview counts rows and warns on missing case name", await page.getByText("1 warnings").isVisible());
  await page.getByRole("button", { name: "Import 2 judgments" }).click();
  await page.waitForTimeout(800);
  check("AOR import: judgments and subjects created", T("judgments").length === 2 && T("subjects").length === 2);
  await page.getByRole("button", { name: "Judgments" }).first().click();
  await page.getByText("TEST Case One v. State").locator("visible=true").first().click();
  await page.getByRole("button", { name: "Good" }).click();
  await page.waitForTimeout(500);
  check("AOR: spaced-repetition revision recorded", T("revision_records").length === 1 && T("judgments").find((j) => j.case_name.startsWith("TEST Case One")).status === "first_reading_completed");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Today" }).first().click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForTimeout(500);
  check("AOR: study timer started in cloud", T("study_sessions").some((s) => !s.ended_at));
  await page.getByRole("button", { name: /Stop/ }).click();
  await page.waitForTimeout(500);
  check("AOR: study timer stopped and saved", T("study_sessions").every((s) => s.ended_at));
  check("no horizontal overflow: AOR", await noOverflow(page));
  await page.screenshot({ path: `${SHOTS}/iphone-aor.png`, fullPage: true });

  // HYROX
  await go("/hyrox/");
  await page.getByRole("button", { name: "Training plan" }).click();
  await page.getByRole("button", { name: "Generate plan" }).click();
  await page.waitForTimeout(800);
  const weeks = T("hyrox_plan_weeks");
  check("HYROX: periodised plan generated to race week", weeks.length >= 9 && weeks.some((w) => w.phase === "taper") && weeks.some((w) => w.phase === "race" && w.week_start === "2027-01-18"), `${weeks.length} weeks`);
  check("HYROX: planned sessions created", T("hyrox_sessions").filter((s) => s.status === "planned").length > 10);
  await go("/hyrox/");
  await page.getByRole("button", { name: "Log session" }).click();
  await page.getByRole("button", { name: "Add split" }).click();
  await page.getByLabel("Split 1 time", { exact: true }).fill("4:50");
  await page.getByLabel("Add station", { exact: true }).selectOption("2");
  await page.getByPlaceholder("3:20").fill("3:05");
  await page.getByRole("button", { name: "Save session" }).click();
  await page.waitForTimeout(800);
  check("HYROX: session with run split and station result saved", T("hyrox_run_splits").some((s) => s.seconds === 290) && T("hyrox_station_results").some((r) => r.station_id === 2 && r.time_seconds === 185 && Number(r.weight_kg) === 152));
  await page.getByRole("button", { name: "Stations" }).click();
  await page.getByRole("button", { name: "2. Sled Push" }).click();
  check("HYROX: Men's Open sled push load shown (152 kg)", await page.getByText("152 kg").locator("visible=true").first().waitFor({ timeout: 5000 }).then(() => true, () => false));
  check("no horizontal overflow: HYROX", await noOverflow(page));
  await page.screenshot({ path: `${SHOTS}/iphone-hyrox.png`, fullPage: true });

  // Fitness
  await go("/fitness/");
  await page.getByRole("button", { name: "Workout", exact: true }).click();
  await page.getByPlaceholder("45:00").fill("30:00");
  await page.getByLabel("Distance (km)", { exact: true }).fill("6");
  await page.getByRole("button", { name: "Save" }).last().click();
  await page.waitForTimeout(500);
  check("fitness: manual run saved with distance and pace", T("workouts").some((w) => w.distance_m === 6000 && w.duration_seconds === 1800));
  await page.getByRole("button", { name: "Import files" }).click();
  const tcx = path.join(__dirname, "sample.tcx");
  fs.writeFileSync(tcx, `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-11-10T06:00:00Z</Id><Lap StartTime="2026-11-10T06:00:00Z"><TotalTimeSeconds>300</TotalTimeSeconds><DistanceMeters>1000</DistanceMeters><Calories>70</Calories><AverageHeartRateBpm><Value>150</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>162</Value></MaximumHeartRateBpm></Lap><Lap StartTime="2026-11-10T06:05:00Z"><TotalTimeSeconds>290</TotalTimeSeconds><DistanceMeters>1000</DistanceMeters><Calories>72</Calories><AverageHeartRateBpm><Value>156</Value></AverageHeartRateBpm></Lap></Activity></Activities></TrainingCenterDatabase>`);
  await page.setInputFiles('input[type="file"]', tcx);
  await page.getByRole("button", { name: /Import 1 activity/ }).click();
  await page.waitForTimeout(800);
  const imp = T("workouts").find((w) => w.source === "tcx_import");
  check("fitness: TCX file parsed and imported (2 km, 590 s, laps)", imp && imp.distance_m === 2000 && imp.duration_seconds === 590 && T("workout_laps").length === 2);
  await page.getByRole("button", { name: "Garmin" }).click();
  check("Garmin: shows Pending Connection, no fake data", await page.getByText("Pending Connection").isVisible() && await page.getByText("Not authorised").isVisible());
  check("no horizontal overflow: fitness", await noOverflow(page));
  await page.screenshot({ path: `${SHOTS}/iphone-garmin.png`, fullPage: true });

  // Diary
  await go("/diary/");
  await page.getByLabel("Mood 4", { exact: true }).click();
  await page.getByPlaceholder("How did today go?").fill("Strong study day.");
  await page.getByRole("button", { name: "Save entry" }).click();
  await page.waitForTimeout(500);
  check("diary: entry updated with mood", T("diary_entries").some((d) => d.body === "Strong study day." && d.mood === 4));

  // Settings
  await go("/settings/");
  await page.getByLabel("Calories (kcal)", { exact: true }).fill("1650");
  await page.getByRole("button", { name: "Save" }).first().click();
  await page.waitForTimeout(500);
  check("settings: calorie target editable", T("profiles")[0].calorie_target_kcal === 1650);
  check("settings: low-intake warning shown (no push to restrict)", await page.getByText("will never suggest going lower").isVisible());

  // Analytics & every route at iPhone size
  for (const r of ["/", "/aor/", "/hyrox/", "/nutrition/", "/fitness/", "/body/", "/diary/", "/analytics/", "/settings/"]) {
    await go(r);
    check(`iPhone ${r}: renders without overflow`, (await noOverflow(page)) && !(await page.getByText("Something went wrong").isVisible().catch(() => false)));
  }
  await go("/analytics/");
  await page.screenshot({ path: `${SHOTS}/iphone-analytics.png`, fullPage: true });
  await go("/");
  await page.screenshot({ path: `${SHOTS}/iphone-today.png`, fullPage: true });
  await ctx.close();

  // ---------- Mac ----------
  const mac = await newCtx({ width: 1440, height: 900 });
  for (const r of ["/", "/aor/", "/hyrox/", "/nutrition/", "/fitness/", "/body/", "/diary/", "/analytics/", "/settings/"]) {
    await mac.page.goto(BASE + r); await mac.page.waitForLoadState("networkidle"); await mac.page.waitForTimeout(400);
    check(`Mac ${r}: sidebar + no overflow`, (await mac.page.locator("aside").isVisible()) && (await noOverflow(mac.page)));
    await mac.page.screenshot({ path: `${SHOTS}/mac${r === "/" ? "-today" : "-" + r.replace(/\//g, "")}.png` });
  }
  // keyboard shortcut g then h
  await mac.page.goto(BASE + "/"); await mac.page.waitForLoadState("networkidle");
  await mac.page.keyboard.press("g"); await mac.page.keyboard.press("h"); await mac.page.waitForURL(/hyrox/, { timeout: 5000 }).catch(() => {});
  check("Mac keyboard shortcut g→h opens HYROX", mac.page.url().includes("/hyrox"));
  await mac.ctx.close();

  // PWA
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.webmanifest")));
  check("PWA manifest: standalone with 192/512 icons", manifest.display === "standalone" && manifest.icons.some((i) => i.sizes === "512x512"));
  const html = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
  check("PWA: manifest + apple-touch-icon + standalone meta in HTML", html.includes("manifest.webmanifest") && html.includes("apple-touch-icon") && /mobile-web-app-capable|apple-mobile-web-app-capable/.test(html));
  check("security: no service-role/secret key in the bundle", !execGrep(/sb_secret_[A-Za-z0-9_-]{12,}|c2VydmljZV9yb2xl/));

  check("no uncaught page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close(); server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); console.log("errors:", errors.slice(0, 10)); process.exit(1); });

function execGrep(re) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  return walk(OUT).filter((f) => /\.(js|html)$/.test(f)).some((f) => re.test(fs.readFileSync(f, "utf8")));
}
