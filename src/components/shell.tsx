"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Home, Scale, Weight, Flame, Utensils, BookOpenText, NotebookPen, BarChart3, Settings, MoreHorizontal, Watch } from "lucide-react";
import { useAuth } from "./auth";
import { useSyncState } from "@/lib/hooks";
import { cx, Sheet, Spinner } from "./ui";

export const NAV = [
  { href: "/", label: "Today", icon: Home },
  { href: "/aor/", label: "AOR", icon: Scale },
  { href: "/hyrox/", label: "HYROX", icon: Flame },
  { href: "/nutrition/", label: "Nutrition", icon: Utensils },
  { href: "/fitness/", label: "Fitness & Garmin", icon: Watch },
  { href: "/body/", label: "Weight", icon: Weight },
  { href: "/diary/", label: "Diary", icon: NotebookPen },
  { href: "/analytics/", label: "Analytics", icon: BarChart3 },
  { href: "/settings/", label: "Settings", icon: Settings },
];
const TABS = NAV.slice(0, 4);

function isActive(path: string, href: string) {
  const p = path.endsWith("/") ? path : path + "/";
  return href === "/" ? p === "/" : p.startsWith(href);
}

function SyncDot() {
  const s = useSyncState();
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3" title="Cloud sync status">
      <span className={cx("size-1.5 rounded-full", s === "live" ? "bg-accent" : s === "offline" ? "bg-danger" : "bg-warn animate-pulse")} />
      {s === "live" ? "Synced" : s === "offline" ? "Offline" : "Connecting"}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  const path = usePathname() || "/";
  const router = useRouter();
  const [more, setMore] = useState(false);
  const onLogin = path.startsWith("/login");

  useEffect(() => {
    if (ready && !session && !onLogin) router.replace("/login/");
    if (ready && session && onLogin) router.replace("/");
  }, [ready, session, onLogin, router]);

  useEffect(() => { setMore(false); }, [path]);

  // Keyboard shortcuts on Mac: g then key
  useEffect(() => {
    let g = false; let t: ReturnType<typeof setTimeout>;
    const map: Record<string, string> = { t: "/", a: "/aor/", h: "/hyrox/", n: "/nutrition/", f: "/fitness/", w: "/body/", d: "/diary/", s: "/settings/", y: "/analytics/" };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (g && map[e.key]) { router.push(map[e.key]); g = false; return; }
      g = e.key === "g"; clearTimeout(t); t = setTimeout(() => (g = false), 800);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  if (onLogin) return <>{children}</>;
  if (!ready || !session) return <div className="min-h-dvh grid place-items-center"><Spinner label="Opening AMAN OS…" /></div>;

  return (
    <div className="min-h-dvh lg:flex">
      {/* Mac / desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 h-dvh sticky top-0 border-r border-line-soft bg-[#0e0e10] px-3 py-5">
        <div className="px-3 mb-6">
          <div className="text-[17px] font-bold tracking-tight">AMAN <span className="text-accent">OS</span></div>
          <div className="mt-1"><SyncDot /></div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={cx("flex items-center gap-3 h-10 px-3 rounded-xl text-[14px] font-medium transition",
                isActive(path, href) ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface hover:text-ink")}>
              <Icon className={cx("size-[18px]", isActive(path, href) && "text-accent")} />{label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-3 text-[11px] text-ink-3 leading-relaxed">Shortcuts: <kbd>g</kbd> then <kbd>t</kbd> today · <kbd>a</kbd> AOR · <kbd>h</kbd> HYROX · <kbd>n</kbd> nutrition</div>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="lg:hidden safe-top sticky top-0 z-30 bg-bg/85 backdrop-blur-xl border-b border-line-soft">
          <div className="h-11 px-4 flex items-center justify-between">
            <span className="text-[15px] font-bold tracking-tight">AMAN <span className="text-accent">OS</span></span>
            <SyncDot />
          </div>
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 lg:px-8 pb-tabbar">{children}</main>
      </div>

      {/* iPhone tab bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#111113]/90 backdrop-blur-xl border-t border-line-soft safe-bottom">
        <div className="grid grid-cols-5 h-[60px]">
          {TABS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={cx("flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium", isActive(path, href) ? "text-accent" : "text-ink-3")}>
              <Icon className="size-[22px]" strokeWidth={isActive(path, href) ? 2.3 : 1.8} />{label}
            </Link>
          ))}
          <button onClick={() => setMore(true)} className={cx("flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium", NAV.slice(4).some((n) => isActive(path, n.href)) ? "text-accent" : "text-ink-3")}>
            <MoreHorizontal className="size-[22px]" />More
          </button>
        </div>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <div className="grid grid-cols-3 gap-2">
          {NAV.slice(4).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex flex-col items-center justify-center gap-2 h-24 rounded-2xl bg-surface-2 text-sm font-medium text-center px-2">
              <Icon className="size-6 text-accent" />{label}
            </Link>
          ))}
          <Link href="/aor/#import" className="flex flex-col items-center justify-center gap-2 h-24 rounded-2xl bg-surface-2 text-sm font-medium"><BookOpenText className="size-6 text-accent" />Import cases</Link>
          <Link href="/nutrition/" className="flex flex-col items-center justify-center gap-2 h-24 rounded-2xl bg-surface-2 text-sm font-medium"><Flame className="size-6 text-accent" />Log food</Link>
        </div>
      </Sheet>
    </div>
  );
}
