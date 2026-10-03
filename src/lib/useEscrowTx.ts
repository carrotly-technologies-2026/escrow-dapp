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
  const code = findCustomCode(err);
  if (code !== null && PROGRAM_ERRORS[code]) return PROGRAM_ERRORS[code];
  return err instanceof Error ? err.message : String(err);
}

/** Program errors arrive as nested SolanaErrors with `context.code`. */
function findCustomCode(err: unknown): number | null {
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    const ctx = (cur as { context?: { code?: unknown } }).context;
    if (typeof ctx?.code === "number") return ctx.code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}
