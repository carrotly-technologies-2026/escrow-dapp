import { useCallback, useMemo, useState } from "react";
import { createWalletTransactionSigner } from "@solana/client";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import type { Instruction, TransactionSigner } from "@solana/kit";

/** Signs and sends program instructions with the connected wallet. */
export function useEscrowTx() {
  const { wallet } = useWalletConnection();
  const { send, isSending } = useSendTransaction();
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signer: TransactionSigner | null = useMemo(
    () => (wallet ? createWalletTransactionSigner(wallet).signer : null),
    [wallet]
  );

  const run = useCallback(
    async (
      build: (signer: TransactionSigner) => Instruction | Promise<Instruction>
    ) => {
      if (!signer) return null;
      setError(null);
      setSignature(null);
      try {
        const ix = await build(signer);
        const sig = await send({ instructions: [ix] });
        setSignature(sig);
        return sig;
      } catch (err) {
        console.error(err);
        setError(describeError(err));
        return null;
      }
    },
    [signer, send]
  );

  return { run, signer, isSending, signature, error };
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
