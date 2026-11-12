"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase, errMsg } from "./supabase";

type SyncState = "live" | "connecting" | "offline";
const syncListeners = new Set<(s: SyncState) => void>();
let syncState: SyncState = "connecting";
function setSync(s: SyncState) { syncState = s; syncListeners.forEach((l) => l(s)); }

export function useSyncState() {
  const [s, setS] = useState<SyncState>(syncState);
  useEffect(() => {
    syncListeners.add(setS);
    const on = () => setSync(navigator.onLine ? "live" : "offline");
    window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { syncListeners.delete(setS); window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);
  return s;
}

/**
 * Loads data from Supabase and keeps it fresh across devices:
 * refetches when any listed table changes (Supabase Realtime) and when the
 * app returns to the foreground.
 */
export function useLive<T>(fetcher: () => Promise<T>, tables: string[], deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetcher);
  useLayoutEffect(() => { fetchRef.current = fetcher; });

  const reload = useCallback(async () => {
    try {
      const d = await fetchRef.current();
      setData(d); setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const tableKey = tables.join(",");
  useEffect(() => {
    if (!tables.length) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => { if (timer) clearTimeout(timer); timer = setTimeout(reload, 250); };
    const ch = supabase.channel(`live:${tableKey}:${Math.random().toString(36).slice(2)}`);
    tables.forEach((t) => ch.on("postgres_changes", { event: "*", schema: "public", table: t }, debounced));
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") setSync("live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSync("offline");
    });
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey, reload]);

  return { data, error, loading, reload, setData };
}

/** Throws the Supabase error so callers can surface it. */
export async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}
