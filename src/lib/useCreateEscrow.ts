import { useCallback } from "react";
import type { Address } from "@solana/kit";
import { findEscrowPda, getCreateEscrowInstruction } from "../generated/escrow";
import { saveDetails, type Details } from "./backend";
import { detailsHash } from "./escrow";
import { useEscrowTx } from "./useEscrowTx";

const MIN = 60;
const DAY = 24 * 60 * MIN;

// Demo uses minutes so timeouts can be shown live; real deals use days.
export const PRESETS = {
  demo: {
    label: "Demo (minuty)",
    ship: 5 * MIN,
    confirm: 5 * MIN,
    arbiter: 10 * MIN,
  },
  normal: {
    label: "Standard (dni)",
    ship: 3 * DAY,
    confirm: 7 * DAY,
    arbiter: 7 * DAY,
  },
} as const;
export type Preset = keyof typeof PRESETS;

export const formatPeriod = (secs: number) =>
  secs >= DAY ? `${secs / DAY} dni` : `${secs / MIN} min`;

/** Locks the buyer's funds in a new escrow, then stores the description off-chain. */
export function useCreateEscrow() {
  const tx = useEscrowTx();
  const { run, signer } = tx;

  const create = useCallback(
    async (p: {
      seller: Address;
      arbiter: Address;
      amount: bigint;
      details: Details;
      preset: Preset;
    }): Promise<Address | null> => {
      if (!signer) return null;
      const details = {
        itemTitle: p.details.itemTitle.trim(),
        recipientName: p.details.recipientName.trim(),
        recipientAddress: p.details.recipientAddress.trim(),
      };
      const preset = PRESETS[p.preset];
      const escrowId = BigInt(Date.now());
      const [escrow] = await findEscrowPda({ buyer: signer.address, escrowId });
      const now = Math.floor(Date.now() / 1000);

      const sig = await run(async (buyer) =>
        getCreateEscrowInstruction({
          buyer,
          escrow,
          escrowId,
          seller: p.seller,
          arbiter: p.arbiter,
          amount: p.amount,
          shipDeadline: BigInt(now + preset.ship),
          confirmWindow: BigInt(preset.confirm),
          arbiterWindow: BigInt(preset.arbiter),
          detailsHash: await detailsHash(details),
        })
      );
      if (!sig) return null;

      // The escrow is already live on-chain; the description is only a convenience copy.
      await saveDetailsWhenVisible(escrow, details);
      return escrow;
    },
    [run, signer]
  );

  return { ...tx, create };
}

/**
 * The backend only accepts details once it can read the new escrow on-chain, which
 * can lag a second or two behind the wallet's confirmation, so retry for a while.
 */
async function saveDetailsWhenVisible(escrow: Address, details: Details) {
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      await saveDetails(escrow, details);
      return;
    } catch (err) {
      if (attempt === 14) console.error("Could not save escrow details", err);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
