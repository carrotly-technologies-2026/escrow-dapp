import { BACKEND_URL } from "../config";

export type Details = {
  itemTitle: string;
  recipientName: string;
  recipientAddress: string;
};

export type Validation = {
  verdict: "valid" | "suspicious" | "invalid" | "unavailable";
  carrier?: string | null;
  trackingNumber?: string | null;
  recipientName?: string | null;
  recipientAddress?: string | null;
  shipDate?: string | null;
  reasons: string[];
};

export type Waybill = {
  hash: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  validation: Validation;
  committedOnChain: boolean;
};

export type BackendEscrow = { details: Details | null; waybills: Waybill[] };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Backend: HTTP ${res.status}`);
  }
  return res.json();
}

export const getBackendEscrow = (address: string) =>
  call<BackendEscrow>(`/escrows/${address}`);

export const saveDetails = (address: string, details: Details) =>
  call<Details>(`/escrows/${address}/details`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(details),
  });

export const uploadWaybill = (address: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return call<{ hash: string; validation: Validation }>(
    `/escrows/${address}/waybills`,
    { method: "POST", body: form }
  );
};

export const waybillUrl = (address: string, hash: string) =>
  `${BACKEND_URL}/escrows/${address}/waybills/${hash}`;
