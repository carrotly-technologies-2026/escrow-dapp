import { useState, type FormEvent } from "react";
import { address, isAddress, type Address } from "@solana/kit";
import { DEFAULT_ARBITER } from "../config";
import { parseSol } from "../lib/escrow";
import {
  PRESETS,
  formatPeriod,
  useCreateEscrow,
  type Preset,
} from "../lib/useCreateEscrow";
import { Button, Card, Field, TxResult, inputClass } from "../ui";

export function CreateEscrow({
  onCreated,
}: {
  onCreated: (escrow: Address) => void;
}) {
  const { create, signer, isSending, signature, error } = useCreateEscrow();
  const [form, setForm] = useState({
    seller: "",
    arbiter: DEFAULT_ARBITER as string,
    amount: "",
    itemTitle: "",
    recipientName: "",
    recipientAddress: "",
    preset: "demo" as Preset,
  });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
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
    const escrow = await create({
      seller: address(form.seller),
      arbiter: address(form.arbiter),
      amount,
      details: form,
      preset: form.preset,
    });
    if (escrow) onCreated(escrow);
  }

  if (!signer)
    return (
      <Card title="Nowa transakcja">
        Podłącz portfel, aby założyć transakcję.
      </Card>
    );

  const preset = PRESETS[form.preset];
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
          hint={`Wysyłka: ${formatPeriod(preset.ship)}, potwierdzenie odbioru: ${formatPeriod(preset.confirm)}, decyzja arbitra: ${formatPeriod(preset.arbiter)}.`}
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
