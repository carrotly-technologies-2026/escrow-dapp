import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import type { Address } from "@solana/kit";
import { explorerTx } from "./config";
import { formatSol, rpc } from "./lib/escrow";

export function Card({
  title,
  children,
  aside,
}: PropsWithChildren<{ title?: ReactNode; aside?: ReactNode }>) {
  return (
    <section className="space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
      {(title || aside) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "success";
}) {
  const styles = {
    primary: "bg-brand text-white dark:text-neutral-950 hover:opacity-90",
    secondary: "border border-border-low bg-card hover:shadow-sm",
    danger: "bg-red-600 text-white hover:opacity-90",
    success: "bg-green-600 text-white hover:opacity-90",
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
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
  "w-full rounded-lg border border-border-low bg-card px-3 py-2 text-sm outline-none focus:border-brand";

export type Tone = "neutral" | "good" | "warn" | "bad" | "brand";

const TONES: Record<Tone, string> = {
  neutral: "bg-cream text-foreground/80",
  good: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  bad: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  brand: "bg-brand-soft text-brand",
};

export function Badge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: Tone }>) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${TONES[tone]}`}
    >
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
  if (error)
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
        {error}
      </div>
    );
  if (signature)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950/50 dark:text-green-200">
        <span>✓ Transakcja potwierdzona na Solanie</span>
        <a
          className="font-semibold underline"
          href={explorerTx(signature)}
          target="_blank"
          rel="noreferrer"
        >
          Zobacz w Solana Explorer ↗
        </a>
      </div>
    );
  return null;
}

/** Live SOL balance, refreshed every few seconds so payouts are visible on stage. */
export function useBalance(address: Address | undefined) {
  const [lamports, setLamports] = useState<bigint | null>(null);
  useEffect(() => {
    if (!address) return setLamports(null);
    let alive = true;
    // Hidden tabs don't need fresh balances; this keeps us under the RPC rate limit.
    const load = () =>
      !document.hidden &&
      rpc
        .getBalance(address)
        .send()
        .then(({ value }) => alive && setLamports(value))
        .catch(() => {});
    load();
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [address]);
  return lamports;
}

export function Balance({ address }: { address: Address }) {
  const lamports = useBalance(address);
  return (
    <span className="tabular-nums">
      {lamports === null ? "…" : formatSol(lamports)}
    </span>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9" aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-brand" />
      <path
        d="M16 6 L25 10 V16 C25 21.5 21 25 16 27 C11 25 7 21.5 7 16 V10 Z"
        fill="white"
        opacity="0.95"
      />
      <path
        d="M12 16.5 L15 19.5 L20.5 13"
        stroke="#7c3aed"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
