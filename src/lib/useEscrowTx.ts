import { useCallback, useState } from "react";
import type { Instruction, TransactionSigner } from "@solana/kit";
import { useIdentity } from "./identity";

/** Signs and sends program instructions as the current identity (Phantom or demo wallet). */
export function useEscrowTx() {
  const { identity } = useIdentity();
  const [isSending, setIsSending] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      build: (signer: TransactionSigner) => Instruction | Promise<Instruction>
    ) => {
      if (!identity) return null;
      setError(null);
      setSignature(null);
      setIsSending(true);
      try {
        const sig = await identity.send(await build(identity.signer));
        setSignature(sig);
        return sig;
      } catch (err) {
        console.error(err);
        setError(describeError(err));
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [identity]
  );

  return { run, signer: identity?.signer ?? null, isSending, signature, error };
}

// Program error codes (anchor/programs/escrow/src/lib.rs, EscrowError) in user language.
const PROGRAM_ERRORS: Record<number, string> = {
  6000: "Kwota musi być większa od zera.",
  6001: "Kupujący, sprzedający i arbiter muszą być różnymi portfelami.",
  6002: "Nieprawidłowy termin.",
  6003: "Ta operacja nie jest możliwa w obecnym statusie transakcji.",
  6004: "Termin już minął.",
  6005: "Termin jeszcze nie minął.",
  6006: "Twój portfel nie może wykonać tej operacji.",
  6007: "Brak hasha listu przewozowego.",
  6008: "Udział sprzedającego musi być między 0 a 100%.",
};

function describeError(err: unknown): string {
  const chain = errorChain(err);
  for (const e of chain) {
    const code = e.context?.code;
    if (typeof code === "number" && PROGRAM_ERRORS[code])
      return PROGRAM_ERRORS[code];
  }
  const text = chain
    .map((e) => `${e.message ?? ""} ${(e.context?.logs ?? []).join(" ")}`)
    .join(" ");
  if (
    chain.some(
      (e) =>
        (e.context as { statusCode?: number } | undefined)?.statusCode === 429
    )
  )
    return "Sieć Solana devnet jest chwilowo przeciążona (limit zapytań). Spróbuj ponownie za kilka sekund.";
  if (/insufficient (funds|lamports)/i.test(text))
    return "Za mało SOL na portfelu, aby wykonać transakcję.";
  if (/reject|denied|cancel/i.test(text))
    return "Transakcja odrzucona w portfelu.";
  // Production bundles strip kit's messages to bare codes; show the innermost error.
  const innermost = chain[chain.length - 1];
  return innermost?.message ?? String(err);
}

type ErrorLike = {
  message?: string;
  context?: { code?: unknown; logs?: string[] };
};

/**
 * Flattens nested kit errors: the real cause (program error, simulation failure,
 * wallet rejection) sits inside `cause` or the failed transaction plan result.
 */
function errorChain(err: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  const seen = new Set<unknown>();
  const visit = (e: unknown, depth: number) => {
    if (!e || typeof e !== "object" || seen.has(e) || depth > 10) return;
    seen.add(e);
    const obj = e as Record<string, unknown> & ErrorLike;
    if (typeof obj.message === "string") out.push(obj);
    const ctx = obj.context as Record<string, unknown> | undefined;
    for (const next of [
      obj.cause,
      obj.error,
      obj.status,
      ctx?.transactionPlanResult,
      ...(Array.isArray(obj.plans) ? obj.plans : []),
    ])
      visit(next, depth + 1);
  };
  visit(err, 0);
  return out;
}
