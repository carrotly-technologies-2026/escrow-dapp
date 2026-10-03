import { useCallback, useEffect, useState } from "react";
import type { Address } from "@solana/kit";
import {
  EscrowStatus,
  getClaimTimeoutInstruction,
  getConfirmReceivedInstruction,
  getMarkShippedInstruction,
  getOpenDisputeInstruction,
  getResolveDisputeInstruction,
  type Escrow,
} from "../generated/escrow";
import { explorerAddress } from "../config";
import {
  getBackendEscrow,
  uploadWaybill,
  waybillUrl,
  type BackendEscrow,
  type Validation,
} from "../lib/backend";
import {
  STATUS_LABEL,
  activeDeadline,
  fetchEscrow,
  formatDate,
  formatSol,
  fromHex,
  toHex,
} from "../lib/escrow";
import { useEscrowTx } from "../lib/useEscrowTx";
import { Badge, Button, Card, TxResult } from "../ui";

export function EscrowDetail({ address }: { address: Address }) {
  const [escrow, setEscrow] = useState<Escrow | null | undefined>(undefined);
  const [offChain, setOffChain] = useState<BackendEscrow | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const now = useNow();
  const tx = useEscrowTx();

  const reload = useCallback(async () => {
    setEscrow(await fetchEscrow(address));
    try {
      setOffChain(await getBackendEscrow(address));
      setBackendError(null);
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : String(err));
    }
  }, [address]);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 5_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (escrow === undefined) return <Card title="Transakcja">Ładowanie…</Card>;
  if (escrow === null)
    return (
      <Card title="Transakcja">Nie znaleziono transakcji o tym adresie.</Card>
    );

  const me = tx.signer?.address;
  const role =
    me === escrow.buyer
      ? "kupujący"
      : me === escrow.seller
        ? "sprzedający"
        : me === escrow.arbiter
          ? "arbiter"
          : null;
  const deadline = activeDeadline(escrow);
  const deadlinePassed = deadline !== null && BigInt(now) > deadline.at;
  const committedHash = toHex(new Uint8Array(escrow.waybillHash));

  // Every action re-reads the chain afterwards; the program is the source of truth.
  const act = (build: Parameters<typeof tx.run>[0]) =>
    tx.run(build).then(reload);
  const parties = {
    escrow: address,
    buyer: escrow.buyer,
    seller: escrow.seller,
  };

  return (
    <div className="space-y-6">
      <Card
        title={offChain?.details?.itemTitle ?? "Transakcja"}
        aside={
          <Badge
            tone={escrow.status === EscrowStatus.Disputed ? "bad" : "neutral"}
          >
            {STATUS_LABEL[escrow.status]}
          </Badge>
        }
      >
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted">Kwota w escrow</dt>
          <dd className="font-semibold">{formatSol(escrow.amount)}</dd>
          <dt className="text-muted">Kupujący</dt>
          <dd className="font-mono text-xs break-all">{escrow.buyer}</dd>
          <dt className="text-muted">Sprzedający</dt>
          <dd className="font-mono text-xs break-all">{escrow.seller}</dd>
          <dt className="text-muted">Arbiter</dt>
          <dd className="font-mono text-xs break-all">{escrow.arbiter}</dd>
          {offChain?.details && (
            <>
              <dt className="text-muted">Odbiorca</dt>
              <dd>
                {offChain.details.recipientName},{" "}
                {offChain.details.recipientAddress}
              </dd>
            </>
          )}
          <dt className="text-muted">Założono</dt>
          <dd>{formatDate(escrow.createdAt)}</dd>
          {deadline && (
            <>
              <dt className="text-muted">Termin</dt>
              <dd>
                {formatDate(deadline.at)} (
                {countdown(Number(deadline.at) - now)}) — {deadline.outcome}
              </dd>
            </>
          )}
          {escrow.status === EscrowStatus.Resolved && (
            <>
              <dt className="text-muted">Decyzja arbitra</dt>
              <dd>{escrow.sellerShareBps / 100}% dla sprzedającego</dd>
            </>
          )}
        </dl>
        <p className="text-xs text-muted">
          Twoja rola: <strong>{role ?? "obserwator"}</strong> ·{" "}
          <a
            className="underline"
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
          >
            konto escrow w Solana Explorer ↗
          </a>
        </p>
      </Card>

      {tx.signer && (
        <Card title="Co możesz zrobić">
          <div className="flex flex-wrap gap-3">
            {role === "kupujący" &&
              [
                EscrowStatus.Funded,
                EscrowStatus.Shipped,
                EscrowStatus.Disputed,
              ].includes(escrow.status) && (
                <Button
                  disabled={tx.isSending}
                  onClick={() =>
                    confirm(
                      "Potwierdzasz, że przedmiot dotarł i jest zgodny z opisem? Środki trafią do sprzedającego."
                    ) &&
                    act((buyer) =>
                      getConfirmReceivedInstruction({ ...parties, buyer })
                    )
                  }
                >
                  Otrzymałem — zwolnij środki
                </Button>
              )}
            {(role === "kupujący" || role === "sprzedający") &&
              [EscrowStatus.Funded, EscrowStatus.Shipped].includes(
                escrow.status
              ) &&
              !deadlinePassed && (
                <Button
                  variant="danger"
                  disabled={tx.isSending}
                  onClick={() =>
                    act((party) =>
                      getOpenDisputeInstruction({ escrow: address, party })
                    )
                  }
                >
                  Otwórz spór
                </Button>
              )}
            {deadlinePassed && (
              <Button
                variant="secondary"
                disabled={tx.isSending}
                onClick={() =>
                  act((caller) =>
                    getClaimTimeoutInstruction({ ...parties, caller })
                  )
                }
              >
                Termin minął — wykonaj: {deadline?.outcome}
              </Button>
            )}
          </div>
          {role === "sprzedający" &&
            escrow.status === EscrowStatus.Funded &&
            !deadlinePassed && (
              <ShipForm
                address={address}
                busy={tx.isSending}
                onCommit={(hash) =>
                  act((seller) =>
                    getMarkShippedInstruction({
                      escrow: address,
                      seller,
                      waybillHash: fromHex(hash),
                    })
                  )
                }
              />
            )}
          {role === "arbiter" &&
            escrow.status === EscrowStatus.Disputed &&
            !deadlinePassed && (
              <ResolveForm
                amount={escrow.amount}
                busy={tx.isSending}
                onResolve={(bps) =>
                  act((arbiter) =>
                    getResolveDisputeInstruction({
                      ...parties,
                      arbiter,
                      sellerShareBps: bps,
                    })
                  )
                }
              />
            )}
          <TxResult signature={tx.signature} error={tx.error} />
        </Card>
      )}

      <Card title="List przewozowy">
        {backendError && (
          <p className="text-sm text-amber-600">
            Backend niedostępny: {backendError}
          </p>
        )}
        {escrow.status !== EscrowStatus.Funded &&
          committedHash !== "0".repeat(64) && (
            <p className="text-xs text-muted">
              Sprzedający podpisał na łańcuchu dokument o hashu{" "}
              <span className="font-mono break-all">{committedHash}</span>
            </p>
          )}
        {offChain?.waybills.length === 0 && (
          <p className="text-sm text-muted">
            Sprzedający nie dodał jeszcze listu przewozowego.
          </p>
        )}
        <ul className="space-y-4">
          {offChain?.waybills.map((w) => (
            <li
              key={w.hash}
              className="space-y-2 rounded-xl border border-border-low p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                {w.committedOnChain ? (
                  <Badge tone="good">
                    Podpisany przez sprzedającego on-chain
                  </Badge>
                ) : (
                  <Badge>Niepodpisany on-chain</Badge>
                )}
                <a
                  className="text-sm underline"
                  href={waybillUrl(address, w.hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Otwórz dokument ↗
                </a>
              </div>
              <ValidationView validation={w.validation} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ShipForm({
  address,
  busy,
  onCommit,
}: {
  address: Address;
  busy: boolean;
  onCommit: (hash: string) => void;
}) {
  const [uploaded, setUploaded] = useState<{
    hash: string;
    validation: Validation;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      setUploaded(await uploadWaybill(address, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-border-low pt-4">
      <p className="text-sm font-medium">
        Nadałeś paczkę? Dodaj list przewozowy (PDF lub zdjęcie).
      </p>
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        disabled={uploading}
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        className="text-sm"
      />
      {uploading && (
        <p className="text-sm text-muted">
          Wysyłanie i sprawdzanie dokumentu przez AI…
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {uploaded && (
        <>
          <ValidationView validation={uploaded.validation} />
          <Button disabled={busy} onClick={() => onCommit(uploaded.hash)}>
            Potwierdź wysyłkę (podpisz ten dokument)
          </Button>
        </>
      )}
    </div>
  );
}

function ResolveForm({
  amount,
  busy,
  onResolve,
}: {
  amount: bigint;
  busy: boolean;
  onResolve: (bps: number) => void;
}) {
  const [percent, setPercent] = useState(50);
  const sellerPart = (amount * BigInt(percent * 100)) / 10_000n;
  return (
    <div className="space-y-3 border-t border-border-low pt-4">
      <p className="text-sm font-medium">
        Decyzja arbitra: jaka część trafia do sprzedającego?
      </p>
      <input
        type="range"
        min={0}
        max={100}
        value={percent}
        onChange={(e) => setPercent(Number(e.target.value))}
        className="w-full"
      />
      <p className="text-sm">
        Sprzedający: <strong>{percent}%</strong> ({formatSol(sellerPart)}) ·
        Kupujący: <strong>{100 - percent}%</strong> (
        {formatSol(amount - sellerPart)})
      </p>
      <Button disabled={busy} onClick={() => onResolve(percent * 100)}>
        Rozstrzygnij spór
      </Button>
    </div>
  );
}

const VERDICT: Record<
  Validation["verdict"],
  { label: string; tone: "good" | "warn" | "bad" | "neutral" }
> = {
  valid: { label: "AI: dokument wiarygodny", tone: "good" },
  suspicious: { label: "AI: dokument podejrzany", tone: "warn" },
  invalid: { label: "AI: dokument nieprawidłowy", tone: "bad" },
  unavailable: { label: "AI: ocena niedostępna", tone: "neutral" },
};

function ValidationView({ validation }: { validation: Validation }) {
  const v = VERDICT[validation.verdict];
  const fields = [
    ["Przewoźnik", validation.carrier],
    ["Numer przesyłki", validation.trackingNumber],
    ["Odbiorca", validation.recipientName],
    ["Adres", validation.recipientAddress],
    ["Data nadania", validation.shipDate],
  ].filter(([, value]) => value);
  return (
    <div className="space-y-2 text-sm">
      <Badge tone={v.tone}>{v.label}</Badge>
      {fields.length > 0 && (
        <dl className="grid gap-x-4 sm:grid-cols-[max-content_1fr]">
          {fields.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul className="list-disc pl-5 text-muted">
        {validation.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        Ocena AI jest tylko podpowiedzią — o pieniądzach decyduje program na
        Solanie.
      </p>
    </div>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, []);
  return now;
}

function countdown(secs: number) {
  if (secs <= 0) return "minął";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return d > 0
    ? `za ${d} d ${h} h`
    : h > 0
      ? `za ${h} h ${m} min`
      : `za ${m} min ${s} s`;
}
