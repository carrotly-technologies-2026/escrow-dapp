# Bezpieczna Paczka

Escrow na Solanie dla zakupów z wysyłką między nieznajomymi, z arbitrem (człowiekiem) w razie
sporu. Pieniądze trzyma program on-chain, a nie pośrednik. Uzasadnienie projektu i odpowiedzi na
pytania jury: [`docs/DESIGN.md`](docs/DESIGN.md).

Program na devnecie: `98XjuZZg6GLMZR36ouh2dXtYfDpCp5zLKjtLaSpJGDXj`

## Co gdzie jest

| Ścieżka                               | Co to                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `anchor/programs/escrow/src/lib.rs`   | **Program escrow** — tu znika pośrednik: statusy, terminy, kto może co wypłacić |
| `anchor/programs/escrow/src/tests.rs` | Testy programu (LiteSVM): happy path, uprawnienia, timeouty, spór, podział      |
| `src/pages/`                          | Ekrany: nowa transakcja, lista, szczegóły z akcjami, panel arbitra              |
| `src/lib/`                            | Odczyt kont z łańcucha, wysyłanie transakcji portfelem, klient backendu         |
| `src/generated/escrow/`               | Klient programu wygenerowany przez Codamę z IDL (nie edytować ręcznie)          |

Backend (opis transakcji, list przewozowy, walidacja AI) jest w osobnym repo
`universal-backend` (`src/escrow`). Backend nie ma kluczy i niczego nie egzekwuje.

## Uruchomienie lokalnie

Wymagania: Node 20+, pnpm, a do programu Rust, Solana CLI i Anchor 1.1.2
([instalacja](https://solana.com/docs/intro/installation)).

```bash
pnpm install
cp .env.example .env.local   # ustaw VITE_BACKEND_URL
pnpm dev                     # http://localhost:5173
```

Do testów potrzebne są 3 portfele na devnecie (np. Phantom w trybie devnet): kupujący,
sprzedający i arbiter, każdy z odrobiną SOL z https://faucet.solana.com.

## Program

```bash
pnpm anchor-test             # build + testy
pnpm setup                   # build + regeneracja klienta TS po zmianach w programie
```

Deploy na devnet (portfel z `~/.config/solana/id.json`, ok. 1,5 SOL):

```bash
cd anchor
anchor build
anchor deploy --provider.cluster devnet
# Po demo — odebranie sobie prawa do zmian (nieodwracalne):
solana program set-upgrade-authority 98XjuZZg6GLMZR36ouh2dXtYfDpCp5zLKjtLaSpJGDXj --final
```

## Tryb demo (bez Phantoma)

Ustaw `VITE_DEMO_BUYER_KEY`, `VITE_DEMO_SELLER_KEY`, `VITE_DEMO_ARBITER_KEY` (klucze prywatne
base58 portfeli **tylko devnet**). W prawym górnym rogu pojawi się przełącznik ról
Kupujący / Sprzedający / Arbiter — aplikacja podpisuje transakcje tymi kluczami, więc całe demo
robi się w jednej karcie. Klucze trafiają do publicznego bundla JS: nigdy nie używaj portfeli
z prawdziwymi środkami. Przykładowy list przewozowy: `public/list-przewozowy-demo.pdf`.

## Demo — scenariusz

1. Kupujący: „Sklep HackYeah” → koszulka → „Kup bezpiecznie przez escrow” (albo „Nowa transakcja”).
2. Sprzedający: otwiera transakcję, wgrywa list przewozowy → werdykt AI → „Potwierdź wysyłkę”.
3. Kupujący: „Otrzymałem — zwolnij środki” → środki u sprzedającego.
4. Wariant ze sporem: kupujący „Otwórz spór” → arbiter w „Panelu arbitra” dzieli środki suwakiem.
5. Wariant „ktoś zniknął”: po upływie terminu dowolny portfel klika „Termin minął — wykonaj”.
