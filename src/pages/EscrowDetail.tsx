import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  shortAddress,
  toHex,
} from "../lib/escrow";
import { useEscrowTx } from "../lib/useEscrowTx";
import { Badge, Balance, Button, Card, TxResult, type Tone } from "../ui";

type Role = "kupujący" | "sprzedający" | "arbiter";

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
    const timer = setInterval(reload, 4_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (escrow === undefined) return <Card title="Transakcja">Ładowanie…</Card>;
  if (escrow === null)
    return (
      <Card title="Transakcja">Nie znaleziono transakcji o tym adresie.</Card>
    );

  const me = tx.signer?.address;
  const role: Role | null =
    me === escrow.buyer
      ? "kupujący"
      : me === escrow.seller
        ? "sprzedający"
        : me === escrow.arbiter
          ? "arbiter"
          : null;
  const deadline = activeDeadline(escrow);
  const secondsLeft = deadline ? Number(deadline.at) - now : null;
  const deadlinePassed = secondsLeft !== null && secondsLeft < 0;
  const committedHash = toHex(new Uint8Array(escrow.waybillHash));

  // Every action re-reads the chain afterwards; the program is the source of truth.
  const act = (build: Parameters<typeof tx.run>[0]) =>
    tx.run(build).then(reload);
  const parties = {
    escrow: address,
    buyer: escrow.buyer,
    seller: escrow.seller,
  };
  const status = escrow.status;
  const canDispute =
    (role === "kupujący" || role === "sprzedający") &&
    (status === EscrowStatus.Funded || status === EscrowStatus.Shipped) &&
    !deadlinePassed;
  const canConfirm =
    role === "kupujący" &&
    [EscrowStatus.Funded, EscrowStatus.Shipped, EscrowStatus.Disputed].includes(
      status
    );

  return (
    <div className="space-y-6">
      <Card
        title={offChain?.details?.itemTitle ?? "Transakcja"}
        aside={
          <span className="text-2xl font-bold tabular-nums">
            {formatSol(escrow.amount)}
          </span>
        }
      >
        <Stepper escrow={escrow} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Status">
            <Badge tone={statusTone(status)}>{STATUS_LABEL[status]}</Badge>
          </Tile>
          <Tile label="Następny termin">
            {deadline && secondsLeft !== null ? (
              <>
                <span
                  className={`block text-xl font-bold tabular-nums ${secondsLeft < 60 ? "text-red-600" : ""}`}
                >
                  {countdown(secondsLeft)}
                </span>
                <span className="text-xs text-muted">{deadline.outcome}</span>
              </>
            ) : (
              <span className="text-sm text-muted">
                Zakończone — brak terminów
              </span>
            )}
          </Tile>
          <Tile label="Twoja rola">
            <span className="block text-xl font-bold capitalize">
              {role ?? "obserwator"}
            </span>
            {!me && (
              <span className="text-xs text-muted">
                wybierz rolę w prawym górnym rogu
              </span>
            )}
          </Tile>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <Party label="Kupujący" address={escrow.buyer} />
          <Party label="Sprzedający" address={escrow.seller} />
          <Party label="Arbiter" address={escrow.arbiter} />
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {offChain?.details && (
            <span>
              Dostawa: {offChain.details.recipientName},{" "}
              {offChain.details.recipientAddress}
            </span>
          )}
          <span>Założono: {formatDate(escrow.createdAt)}</span>
          {status === EscrowStatus.Resolved && (
            <span>
              Decyzja arbitra: {escrow.sellerShareBps / 100}% dla sprzedającego
            </span>
          )}
          <a
            className="underline"
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
          >
            Konto escrow w Solana Explorer ↗
          </a>
        </p>
      </Card>

      {tx.signer && (
        <Card title="Co możesz zrobić">
          {!role && !deadlinePassed && (
            <p className="text-sm text-muted">
              Nie jesteś stroną tej transakcji. Przełącz rolę u góry strony.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {canConfirm && (
              <Button
                variant="success"
                disabled={tx.isSending}
                onClick={() =>
                  act((buyer) =>
                    getConfirmReceivedInstruction({ ...parties, buyer })
                  )
                }
              >
                ✓ Otrzymałem — zwolnij środki sprzedającemu
              </Button>
            )}
            {canDispute && (
              <Button
                variant="danger"
                disabled={tx.isSending}
                onClick={() =>
                  act((party) =>
                    getOpenDisputeInstruction({ escrow: address, party })
                  )
                }
              >
                ⚠ Otwórz spór
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
                ⏱ Termin minął — wykonaj: {deadline?.outcome}
              </Button>
            )}
          </div>
          {role === "sprzedający" &&
            status === EscrowStatus.Funded &&
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
            status === EscrowStatus.Disputed &&
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
          {tx.isSending && (
            <p className="text-sm text-muted">
              Wysyłanie transakcji na Solanę…
            </p>
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
        {status !== EscrowStatus.Funded && committedHash !== "0".repeat(64) && (
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

const statusTone = (s: EscrowStatus): Tone =>
  s === EscrowStatus.Disputed
    ? "bad"
    : s === EscrowStatus.Funded || s === EscrowStatus.Shipped
      ? "warn"
      : "good";

/** Visual path of the deal; the dispute branch replaces the happy path when taken. */
function Stepper({ escrow }: { escrow: Escrow }) {
  const s = escrow.status;
  const shipped = escrow.confirmDeadline > 0n;
  const disputed = escrow.disputeDeadline > 0n;
  const final =
    s === EscrowStatus.Released
      ? "Wypłacone sprzedającemu"
      : s === EscrowStatus.Refunded
        ? "Zwrócone kupującemu"
        : s === EscrowStatus.Resolved
          ? "Rozstrzygnięte przez arbitra"
          : disputed
            ? "Decyzja arbitra"
            : "Odbiór potwierdzony";
  const settled =
    s === EscrowStatus.Released ||
    s === EscrowStatus.Refunded ||
    s === EscrowStatus.Resolved;
  // Skip "Wysłane" when the deal ended or went to dispute before shipping.
  const showShipped = shipped || (!settled && !disputed);
  const steps = [
    { label: "Opłacone", done: true },
    ...(showShipped ? [{ label: "Wysłane", done: shipped }] : []),
    ...(disputed ? [{ label: "Spór", done: true, alert: true }] : []),
    { label: final, done: settled },
  ];
  return (
    <ol className="flex items-start gap-2">
      {steps.map((step, i) => (
        <li
          key={step.label}
          className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center sm:flex-row sm:text-left"
        >
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
              step.done
                ? "alert" in step
                  ? "bg-red-600 text-white"
                  : "bg-brand text-white dark:text-neutral-950"
                : "bg-cream text-muted"
            }`}
          >
            {step.done ? ("alert" in step ? "!" : "✓") : i + 1}
          </span>
          <span
            className={`text-xs sm:text-sm ${step.done ? "font-semibold" : "text-muted"}`}
          >
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <span
              className={`hidden h-0.5 flex-1 rounded sm:block ${steps[i + 1].done ? "bg-brand" : "bg-border-low"}`}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1 rounded-xl bg-cream p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

function Party({ label, address }: { label: string; address: Address }) {
  return (
    <div className="rounded-xl border border-border-low p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-mono text-xs">{shortAddress(address)}</p>
      <p className="text-sm font-semibold">
        <Balance address={address} />
      </p>
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
    <div className="space-y-3 rounded-xl border border-dashed border-brand/50 p-4">
      <p className="text-sm font-semibold">
        📦 Nadałeś paczkę? Dodaj list przewozowy (PDF lub zdjęcie).
      </p>
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        disabled={uploading}
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        className="text-sm file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-soft file:px-3 file:py-2 file:font-semibold file:text-brand"
      />
      <p className="text-xs text-muted">
        Na demo możesz użyć{" "}
        <a className="underline" href="/list-przewozowy-demo.pdf" download>
          przykładowego listu przewozowego
        </a>
        .
      </p>
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
            Potwierdź wysyłkę (podpisz ten dokument on-chain)
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
    <div className="space-y-3 rounded-xl border border-dashed border-brand/50 p-4">
      <p className="text-sm font-semibold">
        ⚖ Decyzja arbitra: jaka część trafia do sprzedającego?
      </p>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        onChange={(e) => setPercent(Number(e.target.value))}
        className="w-full accent-brand"
      />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-cream p-3">
          Kupujący: <strong>{100 - percent}%</strong>
          <br />
          {formatSol(amount - sellerPart)}
        </div>
        <div className="rounded-lg bg-cream p-3 text-right">
          Sprzedający: <strong>{percent}%</strong>
          <br />
          {formatSol(sellerPart)}
        </div>
      </div>
      <Button disabled={busy} onClick={() => onResolve(percent * 100)}>
        Rozstrzygnij spór
      </Button>
    </div>
  );
}

const VERDICT: Record<Validation["verdict"], { label: string; tone: Tone }> = {
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
  if (secs <= 0) return "termin minął";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return d > 0
    ? `${d} d ${h} h`
    : h > 0
      ? `${h}:${pad(m)}:${pad(s)}`
      : `${m}:${pad(s)}`;
}
