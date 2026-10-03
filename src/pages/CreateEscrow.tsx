import { useState, type FormEvent } from "react";
import { address, isAddress, type Address } from "@solana/kit";
import { findEscrowPda, getCreateEscrowInstruction } from "../generated/escrow";
import { DEFAULT_ARBITER } from "../config";
import { saveDetails } from "../lib/backend";
import { detailsHash, parseSol } from "../lib/escrow";
import { useEscrowTx } from "../lib/useEscrowTx";
import { Button, Card, Field, TxResult, inputClass } from "../ui";

const MIN = 60;
const DAY = 24 * 60 * MIN;

// Demo uses minutes so timeouts can be shown live; real deals use days.
const PRESETS = {
  demo: {
    label: "Demo (minuty)",
    ship: 5 * MIN,
    confirm: 3 * MIN,
    arbiter: 3 * MIN,
  },
  normal: {
    label: "Standard (dni)",
    ship: 3 * DAY,
    confirm: 7 * DAY,
    arbiter: 7 * DAY,
  },
} as const;

export function CreateEscrow({
  onCreated,
}: {
  onCreated: (escrow: Address) => void;
}) {
  const { run, signer, isSending, signature, error } = useEscrowTx();
  const [form, setForm] = useState({
    seller: "",
    arbiter: DEFAULT_ARBITER as string,
    amount: "",
    itemTitle: "",
    recipientName: "",
    recipientAddress: "",
    preset: "demo" as keyof typeof PRESETS,
  });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    if (!signer) return;
    if (!isAddress(form.seller) || !isAddress(form.arbiter)) {
      setProblem(
        "Adres sprzedającego i arbitra musi być poprawnym adresem portfela Solana."
      );
      return;
    }
    const amount = parseSol(form.amount);
    if (amount <= 0n) {
      setProblem("Podaj kwotę większą od zera.");
      return;
    }

    const details = {
      itemTitle: form.itemTitle.trim(),
      recipientName: form.recipientName.trim(),
      recipientAddress: form.recipientAddress.trim(),
    };
    const preset = PRESETS[form.preset];
    const escrowId = BigInt(Date.now());
    const [escrow] = await findEscrowPda({ buyer: signer.address, escrowId });
    const now = Math.floor(Date.now() / 1000);

    const sig = await run(async (buyer) =>
      getCreateEscrowInstruction({
        buyer,
        escrow,
        escrowId,
        seller: address(form.seller),
        arbiter: address(form.arbiter),
        amount,
        shipDeadline: BigInt(now + preset.ship),
        confirmWindow: BigInt(preset.confirm),
        arbiterWindow: BigInt(preset.arbiter),
        detailsHash: await detailsHash(details),
      })
    );
    if (!sig) return;

    // The escrow is already live on-chain; the description is only a convenience copy.
    try {
      await saveDetails(escrow, details);
    } catch (err) {
      console.error(err);
    }
    onCreated(escrow);
  }

  if (!signer)
    return (
      <Card title="Nowa transakcja">
        Podłącz portfel, aby założyć transakcję.
      </Card>
    );

  return (
    <Card title="Nowa bezpieczna transakcja (kupujący)">
      <p className="text-sm text-muted">
        Pieniądze trafią do programu na Solanie, nie do sprzedającego ani do
        nas. Zostaną wypłacone sprzedającemu dopiero, gdy potwierdzisz odbiór —
        albo zwrócone Tobie, jeśli nie wyśle paczki na czas.
      </p>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Co kupujesz?">
          <input
            required
            maxLength={200}
            className={inputClass}
            value={form.itemTitle}
            onChange={set("itemTitle")}
            placeholder="np. iPhone 14, 128 GB"
          />
        </Field>
        <Field label="Kwota (SOL)">
          <input
            required
            inputMode="decimal"
            className={inputClass}
            value={form.amount}
            onChange={set("amount")}
            placeholder="0.5"
          />
        </Field>
        <Field label="Adres portfela sprzedającego">
          <input
            required
            className={`${inputClass} font-mono`}
            value={form.seller}
            onChange={set("seller")}
          />
        </Field>
        <Field
          label="Adres portfela arbitra"
          hint="Osoba, która rozstrzygnie ewentualny spór. Może tylko podzielić środki między Was."
        >
          <input
            required
            className={`${inputClass} font-mono`}
            value={form.arbiter}
            onChange={set("arbiter")}
          />
        </Field>
        <Field label="Odbiorca paczki (imię i nazwisko)">
          <input
            required
            maxLength={200}
            className={inputClass}
            value={form.recipientName}
            onChange={set("recipientName")}
          />
        </Field>
        <Field label="Adres dostawy">
          <input
            required
            maxLength={200}
            className={inputClass}
            value={form.recipientAddress}
            onChange={set("recipientAddress")}
            placeholder="ul. Przykładowa 1, 00-001 Warszawa"
          />
        </Field>
        <Field
          label="Terminy"
          hint={`Wysyłka: ${fmt(PRESETS[form.preset].ship)}, potwierdzenie odbioru: ${fmt(PRESETS[form.preset].confirm)}, decyzja arbitra: ${fmt(PRESETS[form.preset].arbiter)}.`}
        >
          <select
            className={inputClass}
            value={form.preset}
            onChange={set("preset")}
          >
            {Object.entries(PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={isSending} className="w-full">
            {isSending ? "Podpisywanie…" : "Wpłać do escrow"}
          </Button>
        </div>
      </form>
      {problem && <p className="text-sm text-red-600">{problem}</p>}
      <TxResult signature={signature} error={error} />
    </Card>
  );
}

function fmt(secs: number) {
  return secs >= DAY ? `${secs / DAY} dni` : `${secs / MIN} min`;
}
