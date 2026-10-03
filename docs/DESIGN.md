# Bezpieczna Paczka — escrow na Solanie z arbitrem w razie sporu

## Dla kogo i po co

**Użytkownik:** osoby kupujące i sprzedające używane rzeczy o większej wartości od nieznajomych
w internecie (OLX, Vinted, Allegro Lokalnie), z wysyłką kurierem.

**Relacja finansowa, którą przeprojektowujemy:** zakup z wysyłką między obcymi ludźmi.
Dziś kupujący albo ufa sprzedającemu („wpłacę, a on nie wyśle”), albo serwisowi z „bezpieczną
płatnością”, który trzyma pieniądze, pobiera prowizję, sam rozstrzyga spory i może zablokować
wypłatę. **Pośrednikiem jest serwis trzymający środki.**

**Co zmienia jego usunięcie:** pieniądze trzyma program na Solanie, a nie firma. Reguły
(kto, kiedy i ile może wypłacić) są w kodzie, który każdy może przeczytać, i nikt — także
autorzy — nie może ich zmienić ani ruszyć środków poza tymi regułami. Człowiek (arbiter) jest
potrzebny tylko w sporze i nawet wtedy może jedynie podzielić środki między kupującego
i sprzedającego.

## Architektura

| Część                     | Repo                           | Rola                                                          | Czy egzekwuje warunki?   |
| ------------------------- | ------------------------------ | ------------------------------------------------------------- | ------------------------ |
| Program `escrow` (Anchor) | `escrow-dapp/anchor`           | Trzyma SOL, pilnuje statusów, terminów i uprawnień            | **Tak — jedyne miejsce** |
| Frontend (React + Vite)   | `escrow-dapp/src`              | Portfel, podpisywanie transakcji, widoki stron i arbitra      | Nie                      |
| Backend (NestJS)          | `universal-backend/src/escrow` | Przechowuje opis i list przewozowy, walidacja listu przez LLM | Nie — tylko doradza      |

Backend nie ma żadnych kluczy i nie może podpisać transakcji. Wszystkie transakcje podpisuje
użytkownik swoim portfelem.

## Program on-chain

Konto `Escrow` (PDA, seeds: `"escrow"`, `buyer`, `escrow_id: u64 LE`) trzyma wpłacone SOL
bezpośrednio w swoich lamportach.

Pola: `buyer`, `seller`, `arbiter`, `escrow_id`, `amount`, `status`, `created_at`,
`ship_deadline`, `confirm_window`, `arbiter_window`, `confirm_deadline`, `dispute_deadline`,
`details_hash`, `waybill_hash`, `seller_share_bps`, `bump`.

Statusy: `Funded → Shipped → Released`, `Funded/Shipped → Disputed → Resolved`,
`Funded/Disputed → Refunded`.

| Instrukcja                                                                               | Podpisuje                | Warunek                                                                | Efekt                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `create_escrow(id, amount, ship_deadline, confirm_window, arbiter_window, details_hash)` | kupujący                 | strony różne, kwota > 0, termin w przyszłości                          | wpłata do escrow, `Funded`                                                                    |
| `mark_shipped(waybill_hash)`                                                             | sprzedający              | `Funded`, przed `ship_deadline`                                        | `Shipped`, `confirm_deadline = now + confirm_window`                                          |
| `confirm_received`                                                                       | kupujący                 | `Funded`/`Shipped`/`Disputed`                                          | całość do sprzedającego, `Released`                                                           |
| `open_dispute`                                                                           | kupujący lub sprzedający | `Funded` przed `ship_deadline` albo `Shipped` przed `confirm_deadline` | `Disputed`, `dispute_deadline = now + arbiter_window`                                         |
| `resolve_dispute(seller_share_bps)`                                                      | tylko arbiter            | `Disputed`, przed `dispute_deadline`, bps ≤ 10000                      | podział kwoty, `Resolved`                                                                     |
| `claim_timeout`                                                                          | ktokolwiek               | termin minął                                                           | `Funded` → zwrot kupującemu; `Shipped` → wypłata sprzedającemu; `Disputed` → zwrot kupującemu |

Wypłaty mogą trafić wyłącznie na adresy `buyer`/`seller` zapisane w koncie. Program nie ma
konta admina; po deployu odbieramy upgrade authority (`solana program set-upgrade-authority
--final`), więc autorzy nie mogą nic zmienić.

Terminy są parametrami transakcji (widocznymi dla obu stron), żeby na demo można było ustawić
je na sekundy i pokazać działanie timeoutów na żywo.

Rent konta escrow (~0,002 SOL) zostaje na koncie jako zapis historii transakcji.

## Dokumenty i LLM: hash na łańcuchu, treść poza nim

- Przy `create_escrow` kupujący zapisuje `details_hash = sha256(itemTitle + "\n" +
recipientName + "\n" + recipientAddress)`. Backend przyjmuje opis tylko wtedy, gdy jego hash
  zgadza się z tym na łańcuchu — nie trzeba logowania, a nikt nie podmieni danych odbiorcy.
- Sprzedający wrzuca list przewozowy do backendu, dostaje jego SHA-256 i podpisuje go w
  `mark_shipped`. Liczy się tylko plik, którego hash jest na łańcuchu.
- LLM (Claude, obraz/PDF) ocenia, czy dokument wygląda na list przewozowy, wyciąga przewoźnika,
  numer przesyłki, odbiorcę i datę nadania, porównuje z opisem i datą założenia escrow i zwraca
  werdykt `valid` / `suspicious` / `invalid` z uzasadnieniem. **Werdykt niczego nie blokuje** —
  pomaga kupującemu zdecydować i arbitrowi rozstrzygnąć spór.

## Backend API (`universal-backend`)

| Endpoint                               | Opis                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /escrows/:address/details`       | JSON `{itemTitle, recipientName, recipientAddress}`; 400, jeśli hash ≠ `details_hash` na łańcuchu |
| `POST /escrows/:address/waybills`      | multipart `file` (PDF/JPG/PNG, ≤ 10 MB); escrow musi istnieć; zwraca `{hash, validation}`         |
| `GET /escrows/:address`                | stan z łańcucha + opis + listy przewozowe z walidacją i flagą `committedOnChain`                  |
| `GET /escrows/:address/waybills/:hash` | plik listu przewozowego                                                                           |

Konfiguracja: `SOLANA_RPC_URL`, `ESCROW_PROGRAM_ID`, `ANTHROPIC_API_KEY`, `DATA_DIR`
(SQLite `node:sqlite` + pliki; w Coolify na wolumenie).

## Odpowiedzi na pytania jury

- **Gdzie znika pośrednik?** `anchor/programs/escrow/src/lib.rs` — każda instrukcja sprawdza
  podpisującego, status i termin; wypłaty idą tylko na adresy stron.
- **Co, gdy strona zniknie?** Zawsze jest termin i domyślny wynik (`claim_timeout`), który może
  wywołać ktokolwiek. Środki nigdy nie utkną.
- **Kto co może?** Tabela instrukcji wyżej. Autorzy po odebraniu upgrade authority — nic.
- **Dlaczego blockchain, a nie baza?** Bo w bazie właściciel bazy może przestawić status i
  wypłacić środki komukolwiek — czyli znów jest pośrednikiem, któremu trzeba ufać.
- **Co dalej?** USDC zamiast SOL, wybór arbitra z puli/staking arbitrów, automatyczna
  weryfikacja numeru przesyłki w API przewoźnika (np. przez oracle), reputacja on-chain.
