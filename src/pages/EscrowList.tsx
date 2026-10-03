import { useEffect, useState } from "react";
import type { Address } from "@solana/kit";
import { EscrowStatus } from "../generated/escrow";
import {
  STATUS_LABEL,
  activeDeadline,
  fetchEscrowsFor,
  formatDate,
  formatSol,
  isSettled,
  shortAddress,
  type EscrowWithAddress,
  type Role,
} from "../lib/escrow";
import { Badge, Card } from "../ui";

const TITLES: Record<Role, string> = {
  buyer: "Kupuję",
  seller: "Sprzedaję",
  arbiter: "Spory do rozstrzygnięcia (arbiter)",
};

export function EscrowList({ wallet, role }: { wallet: Address; role: Role }) {
  const [items, setItems] = useState<EscrowWithAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchEscrowsFor(wallet, role)
        .then((list) => alive && setItems(list))
        .catch((err) => alive && setError(String(err)));
    load();
    const timer = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [wallet, role]);

  // Arbiters only care about disputes; the ones they can still decide come first.
  const shown =
    role === "arbiter"
      ? items
          ?.filter((e) => e.data.status === EscrowStatus.Disputed)
          .sort((a, b) => Number(isExpired(a.data)) - Number(isExpired(b.data)))
      : items;

  return (
    <Card title={TITLES[role]}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!shown && !error && <p className="text-sm text-muted">Ładowanie…</p>}
      {shown?.length === 0 && (
        <p className="text-sm text-muted">Brak transakcji.</p>
      )}
      <ul className="divide-y divide-border-low">
        {shown?.map(({ address, data }) => (
          <li key={address}>
            <a
              href={`#/escrow/${address}`}
              className="flex flex-wrap items-center justify-between gap-2 py-3 hover:opacity-80"
            >
              <span className="space-y-0.5">
                <span className="block font-medium">
                  {formatSol(data.amount)}
                </span>
                <span className="block text-xs text-muted">
                  {formatDate(data.createdAt)} ·{" "}
                  {role === "buyer"
                    ? `sprzedający ${shortAddress(data.seller)}`
                    : `kupujący ${shortAddress(data.buyer)}`}
                </span>
              </span>
              {isExpired(data) ? (
                <Badge>Termin minął — {activeDeadline(data)!.outcome}</Badge>
              ) : (
                <Badge
                  tone={
                    data.status === EscrowStatus.Disputed
                      ? "bad"
                      : isSettled(data.status)
                        ? "good"
                        : "warn"
                  }
                >
                  {STATUS_LABEL[data.status]}
                </Badge>
              )}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Past its deadline: only the default outcome (claim_timeout) is still possible. */
function isExpired(e: EscrowWithAddress["data"]) {
  const deadline = activeDeadline(e);
  return deadline !== null && Date.now() / 1000 > Number(deadline.at);
}
