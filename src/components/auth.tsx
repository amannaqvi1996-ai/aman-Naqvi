"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type Profile = {
  id: string; display_name: string | null; timezone: string;
  calorie_target_kcal: number; protein_target_g: number; water_target_ml: number;
  aor_exam_date: string | null; aor_daily_target_judgments: number; aor_weekly_target_judgments: number;
  dashboard_config: Record<string, unknown>;
};

type Ctx = { session: Session | null; ready: boolean; profile: Profile | null; reloadProfile: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ session: null, ready: false, profile: null, reloadProfile: async () => {} });
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  const reloadProfile = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").maybeSingle();
    setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    reloadProfile();
    const ch = supabase.channel("profile-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => reloadProfile())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, reloadProfile]);

  return <AuthCtx.Provider value={{ session, ready, profile, reloadProfile }}>{children}</AuthCtx.Provider>;
}
