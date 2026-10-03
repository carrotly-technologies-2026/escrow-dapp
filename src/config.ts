import type { Address } from "@solana/kit";

export const RPC_URL =
  import.meta.env.VITE_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const BACKEND_URL = (
  import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000"
).replace(/\/$/, "");
/** Arbiter suggested in the create form; the buyer can change it. */
export const DEFAULT_ARBITER = (import.meta.env.VITE_DEFAULT_ARBITER ?? "") as
  Address | "";

export const explorerTx = (signature: string) =>
  `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
export const explorerAddress = (address: string) =>
  `https://explorer.solana.com/address/${address}?cluster=devnet`;

/** Wallet that receives shop orders; defaults to the demo seller wallet. */
export const SHOP_SELLER = (import.meta.env.VITE_SHOP_SELLER ??
  "7oT6f8Pv4fEoqKWDsdSenJs77AMR5dB9bCNJ7DYvEqsv") as Address;
