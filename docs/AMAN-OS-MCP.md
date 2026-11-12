# AMAN OS — ChatGPT MCP connection

This branch adds an authenticated, read-only Model Context Protocol (MCP) server using Supabase Edge Functions and Supabase Auth OAuth 2.1.

## What is included

- `supabase/functions/mcp/index.ts`: stateless Streamable HTTP MCP endpoint. It creates a fresh MCP server and transport per request and disables transport session IDs (`sessionIdGenerator: undefined`), which is required for this per-request Edge Function lifecycle.
- `supabase/config.toml`: disables the Edge Function gateway's legacy JWT check so the MCP OAuth middleware can return its discovery challenge; enables Supabase OAuth 2.1 and dynamic client registration.
- `src/app/oauth/consent/page.tsx`: explicit consent screen hosted by AMAN OS.
- Login continuation support so an unauthenticated user returns to the consent screen after signing in.

## Initial read-only tools

| Tool | Data returned |
|---|---|
| `get_aor_overview` | Aggregate judgment counts, status breakdown, due count and difficult-case count |
| `list_due_aor_reviews` | Case name, citation and limited revision metadata; no personal notes or case facts |
| `get_hyrox_progress` | Events, recent session summaries and station personal bests |
| `get_fitness_summary` | Daily activity and recovery metrics only (workout and weight tables are withheld pending RLS policy verification) |
| `get_nutrition_summary` | Daily calorie and macro totals; no individual food entries |

The `daily_nutrition` and `hyrox_station_pbs` views are filtered explicitly by the authenticated user ID. Base tables with RLS enabled but no policies in the supplied policy export (including `profiles`, `workouts`, and `weight_records`) are not queried. There are deliberately no tools for legal matters, legal documents, diary entries, account deletion, data export, or writing to the database.

## Security model

- Supabase Auth is the OAuth 2.1 authorization server.
- The user signs in to AMAN OS and explicitly approves the requesting MCP client.
- The Edge Function validates each bearer token with `withSupabase({ auth: "user" })`.
- Every database query uses the caller's RLS-scoped Supabase client. No service-role key is used.
- Tools are marked read-only and return selected columns only.
- The Edge Function's gateway-level `verify_jwt` is set to false only because the MCP middleware must answer OAuth discovery before a user token exists. The MCP middleware still requires and verifies a valid user token for tool calls.

## Before deployment — do not skip

1. Confirm your AMAN OS Supabase project uses an **asymmetric JWT signing key (ES256 or RS256)**. The Supabase MCP auth middleware rejects legacy HS256 tokens. Do not rotate signing keys casually; review Supabase's migration guidance first if the project still uses HS256.
2. In Supabase Dashboard → Authentication → OAuth Server, enable OAuth 2.1 and dynamic client registration. Set the authorization path to `/oauth/consent`.
3. In Supabase Dashboard → Authentication → URL Configuration, set the Site URL to the deployed AMAN OS origin. The consent route must be reachable at `https://YOUR-APP-HOST/oauth/consent/`.
4. Review the dynamic OAuth clients and grants periodically. Dynamic registration allows compatible MCP clients to register; it does not grant them access until the user approves.
5. Review and test RLS policies in the actual project. The CSV inspection is not a substitute for testing as an authenticated user and as an unauthenticated caller.

## Deploy

Prerequisites: Node.js 20+, Supabase CLI 2.117.0+, and Deno. From the repository root:

```bash
supabase login
supabase link --project-ref YOUR_SUPABASE_PROJECT_REF
supabase functions deploy mcp
```

For a hosted Supabase project, enable OAuth 2.1, dynamic client registration, and the authorization path in **Dashboard → Authentication → OAuth Server**. Do not rely on `supabase config push` to apply these hosted OAuth Server settings; the TOML section is useful for local development, while the hosted settings must be verified in the Dashboard.

The endpoint will be:

```
https://YOUR_SUPABASE_PROJECT_REF.supabase.co/functions/v1/mcp
```

Deploy the updated AMAN OS frontend to Netlify so the consent route is available on the Site URL. Existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` environment variables are used by the consent page; no service-role secret belongs in the frontend.

## Test

Use the official MCP Inspector with Streamable HTTP transport and the endpoint above. Confirm that:
- an unauthenticated request receives an OAuth discovery challenge;
- the OAuth sign-in and consent flow completes;
- each tool returns only the signed-in user's records;
- a second test account cannot read the first user's records;
- no tool can write or delete data.

Do not consider this production-ready until those checks pass.

## ChatGPT plan availability

Custom MCP server connections in ChatGPT are currently documented as available for Business and Enterprise/Edu workspaces; Pro supports read/fetch access. Go is not listed as supporting custom MCP connections. The server can be built and deployed now, but the ability to add it directly to this ChatGPT account depends on the account/workspace plan and permissions. See the current OpenAI Help Center instructions before attempting to connect.
