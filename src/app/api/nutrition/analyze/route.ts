import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const nutritionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    food_name: { type: "string" },
    portion: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          portion: { type: "string" },
          calories_kcal: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
        },
        required: ["name", "portion", "calories_kcal", "protein_g", "carbs_g", "fat_g"],
      },
    },
    totals: {
      type: "object",
      additionalProperties: false,
      properties: {
        calories_kcal: { type: "number" },
        protein_g: { type: "number" },
        carbs_g: { type: "number" },
        fat_g: { type: "number" },
      },
      required: ["calories_kcal", "protein_g", "carbs_g", "fat_g"],
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["food_name", "portion", "items", "totals", "notes"],
} as const;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "AI nutrition is not configured yet. Add OPENAI_API_KEY to Netlify environment variables, then redeploy." }, { status: 503 });
    }
    if (!supabaseUrl || !publishableKey) {
      return NextResponse.json({ error: "Authentication service is not configured." }, { status: 503 });
    }

    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Please sign in to use AI nutrition." }, { status: 401 });

    const supabase = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });

    const body = await request.json().catch(() => null);
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    if (!description) return NextResponse.json({ error: "Describe the food and quantities first." }, { status: 400 });
    if (description.length > 1200) return NextResponse.json({ error: "Please keep the meal description under 1,200 characters." }, { status: 400 });

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        instructions: [
          "You are a careful nutrition estimation assistant for a food diary.",
          "Estimate calories and protein, carbohydrate, and fat grams for every described food item and the full meal.",
          "Handle Indian foods and household measures naturally: roti, katori, dal, sabzi, kebab, rice, curry, homemade foods, etc.",
          "Use the stated quantity and cooking method. Distinguish cooked from raw weights. Account for oil, ghee, sauces, skin, and fillings when described.",
          "If the user says homemade or restaurant food without a recipe, make a reasonable typical estimate and mention important assumptions in notes.",
          "Do not claim values are verified. Never invent brand-label precision. Use sensible rounded estimates.",
          "The total fields must equal the sum of the item fields, allowing at most 0.1 rounding difference.",
          "If the description is not food, return an empty items array, zero totals, and explain in notes that a food description is required.",
          "Return only the requested structured data.",
        ].join(" "),
        input: description,
        text: {
          format: {
            type: "json_schema",
            name: "nutrition_estimate",
            strict: true,
            schema: nutritionSchema,
          },
        },
        max_output_tokens: 1200,
      }),
    });

    const payload = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      console.error("OpenAI nutrition request failed:", aiResponse.status, payload?.error?.message);
      return NextResponse.json({ error: "The nutrition analyser could not complete the request. Please try again." }, { status: 502 });
    }

    const outputText = payload.output
      ?.flatMap((item: { content?: { type?: string; text?: string }[] }) => item.content ?? [])
      .find((item: { type?: string }) => item.type === "output_text")?.text;
    if (!outputText) return NextResponse.json({ error: "The nutrition analyser returned an empty result. Please try again." }, { status: 502 });

    const estimate = JSON.parse(outputText);
    const numbers = [
      estimate.totals?.calories_kcal,
      estimate.totals?.protein_g,
      estimate.totals?.carbs_g,
      estimate.totals?.fat_g,
    ];
    if (!Array.isArray(estimate.items) || estimate.items.length === 0 || numbers.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0)) {
      return NextResponse.json({ error: estimate.notes?.[0] || "Please provide a clearer food description with quantities." }, { status: 422 });
    }

    return NextResponse.json(estimate);
  } catch (error) {
    console.error("Nutrition analysis error:", error);
    return NextResponse.json({ error: "Something went wrong while analysing this meal." }, { status: 500 });
  }
}
