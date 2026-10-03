import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { explorerTx } from "./config";

export function Card({
  title,
  children,
  aside,
}: PropsWithChildren<{ title: string; aside?: ReactNode }>) {
  return (
    <section className="space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const styles = {
    primary: "bg-foreground text-background hover:opacity-90",
    secondary: "border border-border-low bg-card hover:shadow-sm",
    danger: "bg-red-600 text-white hover:opacity-90",
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2.5 text-sm font-medium transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border-low bg-card px-3 py-2 text-sm outline-none focus:border-foreground/30";

export function Badge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "good" | "warn" | "bad" }>) {
  const styles = {
    neutral: "bg-cream text-foreground/80",
    good: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200",
    warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    bad: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  }[tone];
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {children}
    </span>
  );
}

export function TxResult({
  signature,
  error,
}: {
  signature: string | null;
  error: string | null;
}) {
  if (error) return <p className="text-sm text-red-600">Błąd: {error}</p>;
  if (signature)
    return (
      <p className="text-sm">
        Transakcja potwierdzona.{" "}
        <a
          className="underline"
          href={explorerTx(signature)}
          target="_blank"
          rel="noreferrer"
        >
          Zobacz w Solana Explorer ↗
        </a>
      </p>
    );
  return null;
}
