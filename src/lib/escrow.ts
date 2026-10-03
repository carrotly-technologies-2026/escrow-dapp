import {
  createSolanaRpc,
  getBase64Encoder,
  type Address,
  type Base58EncodedBytes,
} from "@solana/kit";
import {
  ESCROW_PROGRAM_ADDRESS,
  EscrowStatus,
  fetchMaybeEscrow,
  getEscrowDecoder,
  getEscrowSize,
  type Escrow,
} from "../generated/escrow";
import { RPC_URL } from "../config";

export const rpc = createSolanaRpc(RPC_URL);
export const LAMPORTS_PER_SOL = 1_000_000_000n;

export type EscrowWithAddress = { address: Address; data: Escrow };
export type Role = "buyer" | "seller" | "arbiter";

// Byte offsets of the party pubkeys in the account (after the 8-byte discriminator).
const ROLE_OFFSET: Record<Role, bigint> = {
  buyer: 8n,
  seller: 40n,
  arbiter: 72n,
};

export async function fetchEscrow(address: Address): Promise<Escrow | null> {
  const account = await fetchMaybeEscrow(rpc, address);
  return account.exists ? account.data : null;
}

/** All escrows where `wallet` plays `role`, newest first. */
export async function fetchEscrowsFor(
  wallet: Address,
  role: Role
): Promise<EscrowWithAddress[]> {
  const accounts = await rpc
    .getProgramAccounts(ESCROW_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(getEscrowSize()) },
        {
          memcmp: {
            offset: ROLE_OFFSET[role],
            // An address is exactly the base58 encoding of its 32 bytes.
            bytes: wallet as unknown as Base58EncodedBytes,
            encoding: "base58",
          },
        },
      ],
    })
    .send();
  const decoder = getEscrowDecoder();
  return accounts
    .map(({ pubkey, account }) => ({
      address: pubkey,
      data: decoder.decode(getBase64Encoder().encode(account.data[0])),
    }))
    .sort((a, b) => Number(b.data.createdAt - a.data.createdAt));
}

export const STATUS_LABEL: Record<EscrowStatus, string> = {
  [EscrowStatus.Funded]: "Opłacone — czeka na wysyłkę",
  [EscrowStatus.Shipped]: "Wysłane — czeka na potwierdzenie odbioru",
  [EscrowStatus.Disputed]: "Spór — czeka na decyzję arbitra",
  [EscrowStatus.Released]: "Zakończone — środki u sprzedającego",
  [EscrowStatus.Refunded]: "Zakończone — środki zwrócone kupującemu",
  [EscrowStatus.Resolved]: "Zakończone — rozstrzygnięte przez arbitra",
};

export const isSettled = (status: EscrowStatus) =>
  status === EscrowStatus.Released ||
  status === EscrowStatus.Refunded ||
  status === EscrowStatus.Resolved;

/** The deadline that currently matters and what happens when it passes. */
export function activeDeadline(
  e: Escrow
): { at: bigint; outcome: string } | null {
  switch (e.status) {
    case EscrowStatus.Funded:
      return {
        at: e.shipDeadline,
        outcome: "brak wysyłki → zwrot dla kupującego",
      };
    case EscrowStatus.Shipped:
      return {
        at: e.confirmDeadline,
        outcome: "brak reakcji kupującego → wypłata dla sprzedającego",
      };
    case EscrowStatus.Disputed:
      return {
        at: e.disputeDeadline,
        outcome: "brak decyzji arbitra → zwrot dla kupującego",
      };
    default:
      return null;
  }
}

export const formatSol = (lamports: bigint) =>
  `${(Number(lamports) / Number(LAMPORTS_PER_SOL)).toLocaleString("pl-PL", {
    maximumFractionDigits: 9,
  })} SOL`;

export const parseSol = (sol: string): bigint => {
  const [whole, frac = ""] = sol.trim().replace(",", ".").split(".");
  return (
    BigInt(whole || "0") * LAMPORTS_PER_SOL +
    BigInt(frac.padEnd(9, "0").slice(0, 9))
  );
};

export const formatDate = (unix: bigint) =>
  new Date(Number(unix) * 1000).toLocaleString("pl-PL");

export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export async function sha256(data: BufferSource): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/** Must match the backend: sha256 of the trimmed fields joined with "\n". */
export const detailsHash = (d: {
  itemTitle: string;
  recipientName: string;
  recipientAddress: string;
}) =>
  sha256(
    new TextEncoder().encode(
      [d.itemTitle, d.recipientName, d.recipientAddress]
        .map((s) => s.trim())
        .join("\n")
    )
  );
