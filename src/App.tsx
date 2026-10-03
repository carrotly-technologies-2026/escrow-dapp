import { useEffect, useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { isAddress } from "@solana/kit";
import { CreateEscrow } from "./pages/CreateEscrow";
import { EscrowDetail } from "./pages/EscrowDetail";
import { EscrowList } from "./pages/EscrowList";
import { Shop } from "./pages/Shop";
import { DEMO_ROLE_LABEL, useIdentity, type DemoRole } from "./lib/identity";
import { shortAddress } from "./lib/escrow";
import { Balance, Button, Logo } from "./ui";

const TABS = [
  { hash: "#/sklep", label: "Sklep HackYeah" },
  { hash: "#/", label: "Moje transakcje" },
  { hash: "#/new", label: "Nowa transakcja" },
  { hash: "#/arbiter", label: "Panel arbitra" },
];

// Hash routing keeps the app a static site (no server rewrites needed on hosting).
function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

const openEscrow = (escrow: string) =>
  (window.location.hash = `#/escrow/${escrow}`);

export default function App() {
  const { identity } = useIdentity();
  const hash = useHash();
  const me = identity?.address;
  const escrowMatch = hash.match(/^#\/escrow\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);

  let page;
  if (escrowMatch && isAddress(escrowMatch[1])) {
    page = <EscrowDetail address={escrowMatch[1]} />;
  } else if (hash === "#/sklep") {
    // The shop is browsable without a wallet; checkout asks to connect one.
    page = <Shop onOrdered={openEscrow} />;
  } else if (!me) {
    page = <Hero />;
  } else if (hash === "#/new") {
    page = <CreateEscrow onCreated={openEscrow} />;
  } else if (hash === "#/arbiter") {
    page = <EscrowList wallet={me} role="arbiter" />;
  } else {
    page = (
      <>
        <EscrowList wallet={me} role="buyer" />
        <EscrowList wallet={me} role="seller" />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-bg1 text-foreground">
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <a href="#/" className="flex items-center gap-3">
            <Logo />
            <span>
              <span className="block text-xl font-bold tracking-tight">
                Bezpieczna Paczka
              </span>
              <span className="block text-xs text-muted">
                escrow na Solanie · devnet
              </span>
            </span>
          </a>
          <IdentitySwitcher />
        </header>
        <nav className="flex flex-wrap gap-2 text-sm">
          {TABS.map((t) => (
            <a
              key={t.hash}
              href={t.hash}
              className={`rounded-full px-4 py-1.5 font-medium transition ${
                hash === t.hash
                  ? "bg-brand text-white dark:text-neutral-950"
                  : "bg-cream hover:bg-brand-soft"
              }`}
            >
              {t.label}
            </a>
          ))}
        </nav>
        {page}
        <footer className="pt-6 text-center text-xs text-muted">
          Pieniądze trzyma program on-chain, nie my. Backend przechowuje tylko
          dokumenty i nie ma żadnych kluczy.
        </footer>
      </main>
    </div>
  );
}

/** Demo role buttons (built-in devnet wallets) plus Phantom, with the live balance. */
function IdentitySwitcher() {
  const { identity, demoRoles, demoRole, setDemoRole } = useIdentity();
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-1 rounded-xl bg-cream p-1">
        {demoRoles.map((role: DemoRole) => (
          <button
            key={role}
            onClick={() => setDemoRole(role)}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              demoRole === role
                ? "bg-brand text-white shadow-sm dark:text-neutral-950"
                : "hover:bg-card"
            }`}
          >
            {DEMO_ROLE_LABEL[role]}
          </button>
        ))}
        {wallet ? (
          <button
            onClick={() => (demoRole ? setDemoRole(null) : void disconnect())}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              !demoRole
                ? "bg-brand text-white shadow-sm dark:text-neutral-950"
                : "hover:bg-card"
            }`}
            title={demoRole ? "Przełącz na Phantom" : "Rozłącz Phantom"}
          >
            {demoRole ? "Phantom" : "Phantom · rozłącz"}
          </button>
        ) : (
          connectors.map((c) => (
            <Button
              key={c.id}
              variant="secondary"
              className="!py-1.5"
              disabled={status === "connecting"}
              onClick={() => {
                setDemoRole(null);
                connect(c.id);
              }}
            >
              Połącz: {c.name}
            </Button>
          ))
        )}
      </div>
      {identity ? (
        <p className="text-xs text-muted">
          <span className="font-mono">{shortAddress(identity.address)}</span> ·
          saldo{" "}
          <strong className="text-foreground">
            <Balance address={identity.address} />
          </strong>
        </p>
      ) : (
        demoRoles.length === 0 &&
        connectors.length === 0 && (
          <p className="text-xs text-muted">
            Zainstaluj portfel Solana (np. Phantom).
          </p>
        )
      )}
    </div>
  );
}

function Hero() {
  const steps = [
    {
      icon: "🔒",
      title: "Kupujący płaci do programu",
      text: "Pieniądze trafiają do escrow na Solanie — nie do sprzedającego i nie do nas.",
    },
    {
      icon: "📦",
      title: "Sprzedający wysyła paczkę",
      text: "Dodaje list przewozowy, AI sprawdza dokument, a jego hash trafia na łańcuch.",
    },
    {
      icon: "✅",
      title: "Odbiór zwalnia środki",
      text: "Kupujący potwierdza odbiór i pieniądze same trafiają do sprzedającego.",
    },
  ];
  return (
    <section className="space-y-8 rounded-3xl border border-border-low bg-card px-6 py-10 sm:px-10">
      <div className="max-w-2xl space-y-4">
        <span className="inline-block rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">
          Finanse bez pośrednika
        </span>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Kupuj od nieznajomych bez ryzyka.
        </h1>
        <p className="text-muted">
          Pieniędzy nie trzyma sklep ani serwis ogłoszeniowy, tylko program,
          którego reguł nikt nie może zmienić. Spór? Rozstrzyga go człowiek —
          arbiter, który może jedynie podzielić środki między strony. Ktoś
          zniknął? Po terminie program sam oddaje pieniądze.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href="#/sklep">
            <Button>Wypróbuj w sklepie HackYeah</Button>
          </a>
          <span className="self-center text-sm text-muted">
            albo wybierz rolę w prawym górnym rogu
          </span>
        </div>
      </div>
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="space-y-2 rounded-2xl bg-cream p-5">
            <span className="text-2xl" aria-hidden>
              {s.icon}
            </span>
            <p className="font-semibold">
              {i + 1}. {s.title}
            </p>
            <p className="text-sm text-muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
