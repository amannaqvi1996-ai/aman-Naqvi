"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { X, Loader2, AlertTriangle, Inbox } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(" "); }

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pt-4 pb-5 lg:pt-8">
      <div className="min-w-0">
        <h1 className="text-[28px] lg:text-[32px] font-bold tracking-tight leading-tight">{title}</h1>
        {subtitle && <p className="text-ink-2 text-sm mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function Card({ children, className, title, action, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx("bg-surface border border-line-soft rounded-[var(--radius-card)]", pad && "p-4 lg:p-5", className)}>
      {(title || action) && (
        <div className={cx("flex items-center justify-between gap-2 mb-3", !pad && "px-4 pt-4 lg:px-5 lg:pt-5")}>
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-3">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; loading?: boolean };
export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none select-none",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-11 px-4 text-[15px]",
        size === "lg" && "h-[52px] px-5 text-base w-full",
        variant === "primary" && "bg-accent text-accent-ink hover:bg-accent-dim",
        variant === "secondary" && "bg-surface-3 text-ink hover:bg-[#303035]",
        variant === "ghost" && "text-ink-2 hover:text-ink hover:bg-surface-2",
        variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="block text-[13px] font-medium text-ink-2 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-3 mt-1">{hint}</span>}
    </label>
  );
}
const inputCls = "w-full h-11 rounded-xl bg-surface-2 border border-line px-3 text-ink placeholder:text-ink-3 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15 transition";
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={cx(inputCls, props.className)} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={cx(inputCls, "appearance-none pr-8", props.className)} />; }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={cx(inputCls, "h-auto min-h-24 py-2.5 leading-relaxed", props.className)} />; }

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = o; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center anim-fade" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={cx("relative w-full bg-surface border border-line rounded-t-[22px] md:rounded-[22px] max-h-[92dvh] flex flex-col anim-sheet safe-bottom", wide ? "md:max-w-2xl" : "md:max-w-lg")}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line-soft">
          <h3 className="text-[17px] font-semibold">{title}</h3>
          <button onClick={onClose} className="size-9 -mr-2 grid place-items-center rounded-full text-ink-2 hover:bg-surface-2" aria-label="Close"><X className="size-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center gap-2 text-ink-3 text-sm py-8 justify-center"><Loader2 className="size-4 animate-spin" />{label ?? "Loading…"}</div>;
}
export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger flex items-start gap-2">
      <AlertTriangle className="size-4 mt-0.5 shrink-0" />
      <div className="flex-1">{error}</div>
      {onRetry && <button className="underline" onClick={onRetry}>Retry</button>}
    </div>
  );
}
export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-8 px-4">
      <Inbox className="size-8 mx-auto text-ink-3 mb-2" strokeWidth={1.5} />
      <p className="font-medium">{title}</p>
      {body && <p className="text-sm text-ink-3 mt-1 max-w-sm mx-auto">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Ring({ value, max, size = 92, stroke = 9, color = "var(--color-accent)", children }: { value: number; max: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-surface-3)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset .5s ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function Bar({ value, max, color = "bg-accent" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return <div className="h-2 rounded-full bg-surface-3 overflow-hidden"><div className={cx("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} /></div>;
}

export function Stat({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ink-3 font-medium">{label}</div>
      <div className="text-[22px] font-semibold tabular leading-tight mt-0.5">{value}{unit && <span className="text-sm text-ink-3 font-medium ml-1">{unit}</span>}</div>
      {sub && <div className="text-xs text-ink-3 mt-0.5">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-surface-2 border border-line-soft overflow-x-auto scrollbar-none max-w-full">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cx("px-3 h-8 rounded-lg text-sm font-medium whitespace-nowrap transition", value === o.value ? "bg-surface-3 text-ink shadow-sm" : "text-ink-3 hover:text-ink-2")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "danger" | "info" }) {
  return (
    <span className={cx("inline-flex items-center h-6 px-2 rounded-md text-xs font-medium whitespace-nowrap",
      tone === "neutral" && "bg-surface-3 text-ink-2", tone === "accent" && "bg-accent/15 text-accent",
      tone === "warn" && "bg-warn/15 text-warn", tone === "danger" && "bg-danger/15 text-danger", tone === "info" && "bg-info/15 text-info")}>
      {children}
    </span>
  );
}

// ---------- Toasts & confirm ----------
type Toast = { id: number; text: string; tone: "ok" | "err" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "err") => void>(() => {});
export function useToast() { return useContext(ToastCtx); }
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "err" ? 6000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-[60] left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+12px)] flex flex-col gap-2 w-[min(92vw,420px)] pointer-events-none">
        {items.map((t) => (
          <div key={t.id} role="status" className={cx("anim-sheet rounded-2xl px-4 py-3 text-sm font-medium shadow-2xl border backdrop-blur-xl",
            t.tone === "ok" ? "bg-surface-2/95 border-line text-ink" : "bg-[#2a1515]/95 border-danger/40 text-danger")}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Confirm({ open, title, body, confirmLabel = "Delete", onConfirm, onClose }: { open: boolean; title: string; body?: string; confirmLabel?: string; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {body && <p className="text-ink-2 text-sm mb-4">{body}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmLabel}</Button>
      </div>
    </Sheet>
  );
}

export function ListRow({ children, onClick, right }: { children: ReactNode; onClick?: () => void; right?: ReactNode }) {
  const C = onClick ? "button" : "div";
  return (
    <C onClick={onClick} className={cx("w-full text-left flex items-center gap-3 px-4 py-3 min-h-[56px] border-t border-line-soft first:border-t-0", onClick && "hover:bg-surface-2 active:bg-surface-2 transition")}>
      <div className="flex-1 min-w-0">{children}</div>
      {right}
    </C>
  );
}
