"use client";

import { useEffect, useState } from "react";
import { supabase, errMsg } from "@/lib/supabase";
import { useAuth } from "@/components/auth";

type AuthorizationDetails = {
  authorization_id: string;
  client: { name: string };
  redirect_uri: string;
  scope?: string;
};

export default function OAuthConsentPage() {
  const { session, ready } = useAuth();
  const [authorizationId, setAuthorizationId] = useState("");
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("authorization_id");
    if (!id) {
      setError("This authorization link is incomplete. Close this page and reconnect AMAN OS.");
      return;
    }
    setAuthorizationId(id);
  }, []);

  useEffect(() => {
    if (!ready || !authorizationId) return;

    if (!session) {
      const next = `/oauth/consent/?authorization_id=${encodeURIComponent(authorizationId)}`;
      window.location.replace(`/login/?next=${encodeURIComponent(next)}`);
      return;
    }

    let cancelled = false;
    setError(null);

    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: authError }) => {
      if (cancelled) return;
      if (authError || !data) {
        setError(authError?.message ?? "The authorization request could not be verified.");
        return;
      }
      if (!("authorization_id" in data)) {
        window.location.replace(data.redirect_url);
        return;
      }
      setDetails(data as AuthorizationDetails);
    });

    return () => {
      cancelled = true;
    };
  }, [ready, session, authorizationId]);

  async function decide(decision: "approve" | "deny") {
    if (!authorizationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        decision === "approve"
          ? await supabase.auth.oauth.approveAuthorization(authorizationId)
          : await supabase.auth.oauth.denyAuthorization(authorizationId);
      if (result.error) throw result.error;
      window.location.assign(result.data.redirect_url);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  const scopes = details?.scope?.split(" ").filter(Boolean) ?? [];

  return (
    <main className="min-h-dvh grid place-items-center px-5 py-10">
      <section className="w-full max-w-lg rounded-3xl border border-line bg-surface p-6 sm:p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl border border-line bg-surface-2 text-xl font-bold text-accent">A</div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-ink-3">AMAN OS</p>
            <h1 className="text-xl font-semibold">Connection permission</h1>
          </div>
        </div>

        {!details && !error && <p className="text-sm text-ink-2">Checking the authorization request…</p>}

        {details && (
          <>
            <h2 className="text-lg font-semibold">Allow {details.client?.name ?? "this application"} to connect?</h2>
            <p className="mt-2 text-sm leading-6 text-ink-2">
              This connection will let the application read selected AMAN OS summaries while acting as your signed-in account.
              It cannot create, edit or delete your records.
            </p>

            <div className="mt-5 rounded-2xl border border-line bg-surface-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Read-only access requested</p>
              <ul className="mt-3 space-y-2 text-sm text-ink-2">
                <li>• AOR study progress and due-review case metadata</li>
                <li>• HYROX events, training sessions and station bests</li>
                <li>• Daily activity and recovery metrics</li>
                <li>• Daily nutrition totals (not individual food entries)</li>
              </ul>
              <p className="mt-3 text-xs text-ink-3">Legal matters, document contents and diary entries are not included in the MCP tools.</p>
            </div>

            {scopes.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-ink-3">OAuth scopes requested</p>
                <p className="mt-1 break-words text-xs text-ink-2">{scopes.join(", ")}</p>
              </div>
            )}

            <p className="mt-4 break-all text-xs text-ink-3">Redirect destination: {details.redirect_uri}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => decide("deny")}
                className="rounded-xl border border-line px-4 py-3 text-sm font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
              >
                Deny
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decide("approve")}
                className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Please wait…" : "Approve connection"}
              </button>
            </div>
          </>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </section>
    </main>
  );
}
