"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, Download, Trash2, AlertTriangle, Smartphone, Laptop } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { useAuth } from "@/components/auth";
import { Card, PageHeader, Button, Field, Input, useToast, Sheet } from "@/components/ui";

export default function SettingsPage() {
  const { profile, reloadProfile, session } = useAuth();
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [newPw, setNewPw] = useState("");

  useEffect(() => {
    if (!profile) return;
    setF({ display_name: profile.display_name ?? "", calorie_target_kcal: String(profile.calorie_target_kcal), protein_target_g: String(profile.protein_target_g), water_target_ml: String(profile.water_target_ml), aor_daily_target_judgments: String(profile.aor_daily_target_judgments), aor_weekly_target_judgments: String(profile.aor_weekly_target_judgments), aor_exam_date: profile.aor_exam_date ?? "" });
  }, [profile]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.from("profiles").update({
      display_name: f.display_name || null, calorie_target_kcal: Number(f.calorie_target_kcal), protein_target_g: Number(f.protein_target_g), water_target_ml: Number(f.water_target_ml),
      aor_daily_target_judgments: Number(f.aor_daily_target_judgments), aor_weekly_target_judgments: Number(f.aor_weekly_target_judgments), aor_exam_date: f.aor_exam_date || null,
    }).eq("id", profile!.id);
    setBusy(false);
    if (error) toast(/check/i.test(error.message) ? "One of the values is outside the allowed range (calories 1000–6000, protein 20–400 g)" : errMsg(error), "err");
    else { toast("Settings saved"); reloadProfile(); }
  }

  async function exportData() {
    const { data, error } = await supabase.rpc("export_my_data");
    if (error) return toast(errMsg(error), "err");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `aman-os-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    toast("Export downloaded");
  }

  async function changePassword() {
    if (newPw.length < 8) return toast("Use at least 8 characters", "err");
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) toast(errMsg(error), "err"); else { setNewPw(""); toast("Password updated"); }
  }

  const kcal = Number(f.calorie_target_kcal || 0);
  return (
    <>
      <PageHeader title="Settings" subtitle={session?.user.email} />
      <div className="grid gap-3 lg:gap-4 lg:grid-cols-2">
        <Card title="Profile & targets">
          <form onSubmit={save} className="space-y-4">
            <Field label="Display name"><Input value={f.display_name ?? ""} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Calories (kcal)"><Input inputMode="numeric" value={f.calorie_target_kcal ?? ""} onChange={(e) => setF({ ...f, calorie_target_kcal: e.target.value })} /></Field>
              <Field label="Protein (g)"><Input inputMode="numeric" value={f.protein_target_g ?? ""} onChange={(e) => setF({ ...f, protein_target_g: e.target.value })} /></Field>
              <Field label="Water (ml)"><Input inputMode="numeric" value={f.water_target_ml ?? ""} onChange={(e) => setF({ ...f, water_target_ml: e.target.value })} /></Field>
            </div>
            {kcal > 0 && kcal < 1700 && (
              <div className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs text-warn flex gap-2"><AlertTriangle className="size-4 shrink-0" />
                <span>{kcal} kcal is a low intake alongside HYROX training. Watch for fatigue, poor sleep, stalled performance or frequent illness — if they appear, raise the target and get advice from a doctor or registered dietitian. AMAN OS will never suggest going lower.</span></div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <Field label="AOR / day"><Input inputMode="numeric" value={f.aor_daily_target_judgments ?? ""} onChange={(e) => setF({ ...f, aor_daily_target_judgments: e.target.value })} /></Field>
              <Field label="AOR / week"><Input inputMode="numeric" value={f.aor_weekly_target_judgments ?? ""} onChange={(e) => setF({ ...f, aor_weekly_target_judgments: e.target.value })} /></Field>
              <Field label="AOR exam date"><Input type="date" value={f.aor_exam_date ?? ""} onChange={(e) => setF({ ...f, aor_exam_date: e.target.value })} /></Field>
            </div>
            <Button size="lg" type="submit" loading={busy}>Save</Button>
          </form>
          <p className="text-xs text-ink-3 mt-3">HYROX division is set on the <Link href="/hyrox/" className="text-accent">HYROX overview</Link>.</p>
        </Card>
        <div className="space-y-3 lg:space-y-4">
          <Card title="Install on your devices">
            <div className="space-y-3 text-sm text-ink-2">
              <div className="flex gap-3"><Smartphone className="size-5 text-accent shrink-0" /><p><b>iPhone:</b> open this site in Safari → Share → <b>Add to Home Screen</b>. It opens full-screen like an app.</p></div>
              <div className="flex gap-3"><Laptop className="size-5 text-accent shrink-0" /><p><b>Mac:</b> in Safari choose File → <b>Add to Dock</b>; in Chrome use the install icon in the address bar.</p></div>
              <p className="text-xs text-ink-3">Both devices use the same cloud account — changes appear on the other device within seconds.</p>
            </div>
          </Card>
          <Card title="Account">
            <div className="space-y-3">
              <div className="flex gap-2"><Input type="password" placeholder="New password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /><Button variant="secondary" onClick={changePassword}>Change</Button></div>
              <Button variant="secondary" className="w-full" onClick={exportData}><Download className="size-4" />Export all my data (JSON)</Button>
              <Button variant="secondary" className="w-full" onClick={() => supabase.auth.signOut()}><LogOut className="size-4" />Sign out</Button>
              <Button variant="danger" className="w-full" onClick={() => setDelOpen(true)}><Trash2 className="size-4" />Delete account</Button>
            </div>
          </Card>
        </div>
      </div>
      <Sheet open={delOpen} onClose={() => setDelOpen(false)} title="Delete account permanently">
        <p className="text-sm text-ink-2 mb-3">This permanently deletes your account and every record in AMAN OS. Export your data first if you want a copy. Type <b>DELETE MY ACCOUNT</b> to confirm.</p>
        <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="DELETE MY ACCOUNT" />
        <Button variant="danger" size="lg" className="mt-4" disabled={phrase !== "DELETE MY ACCOUNT"} onClick={async () => {
          const { error } = await supabase.rpc("delete_my_account", { confirm: phrase });
          if (error) return toast(errMsg(error), "err");
          await supabase.auth.signOut();
        }}>Delete everything</Button>
      </Sheet>
    </>
  );
}
