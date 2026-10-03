import { useEffect, useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { isAddress } from "@solana/kit";
import { CreateEscrow } from "./pages/CreateEscrow";
import { EscrowDetail } from "./pages/EscrowDetail";
import { EscrowList } from "./pages/EscrowList";
import { Shop } from "./pages/Shop";
import { Button, Card } from "./ui";
import type { Role } from "./lib/escrow";

const TABS: { hash: string; label: string }[] = [
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

export default function App() {
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();
  const hash = useHash();
  const me = wallet?.account.address;
  const escrowMatch = hash.match(/^#\/escrow\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);

  let page;
  const openEscrow = (escrow: string) =>
    (window.location.hash = `#/escrow/${escrow}`);

  if (escrowMatch && isAddress(escrowMatch[1])) {
    page = <EscrowDetail address={escrowMatch[1]} />;
  } else if (hash === "#/sklep") {
    // The shop is browsable without a wallet; checkout asks to connect one.
    page = <Shop onOrdered={openEscrow} />;
  } else if (!me) {
    page = (
      <Card title="Jak to działa">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>
            Kupujący wpłaca pieniądze do programu na Solanie — nie do
            sprzedającego i nie do nas.
          </li>
          <li>
            Sprzedający nadaje paczkę i dodaje list przewozowy; AI sprawdza
            dokument.
          </li>
          <li>
            Kupujący potwierdza odbiór → pieniądze trafiają do sprzedającego.
          </li>
          <li>
            Problem? Każda strona może otworzyć spór, który rozstrzyga wskazany
            arbiter.
          </li>
          <li>
            Ktoś zniknął? Po terminie program sam wykonuje domyślny wynik.
            Środki nigdy nie utkną.
          </li>
        </ol>
        <p className="text-sm text-muted">
          Podłącz portfel (devnet), aby zacząć — albo zajrzyj do{" "}
          <a className="underline" href="#/sklep">
            sklepu HackYeah
          </a>
          , który płaci przez escrow.
        </p>
      </Card>
    );
  } else if (hash === "#/new") {
    page = <CreateEscrow onCreated={openEscrow} />;
  } else if (hash === "#/arbiter") {
    page = <EscrowList wallet={me} role="arbiter" />;
  } else {
    page = (["buyer", "seller"] as Role[]).map((role) => (
      <EscrowList key={role} wallet={me} role={role} />
    ));
  }

  return (
    <div className="min-h-screen bg-bg1 text-foreground">
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <a href="#/" className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Bezpieczna Paczka
            </h1>
            <p className="text-sm text-muted">
              Kupuj od nieznajomych bez ryzyka — pieniądze pilnuje program, nie
              pośrednik.
            </p>
          </a>
          {status === "connected" && me ? (
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-cream px-3 py-2 font-mono text-xs">
                {me.slice(0, 4)}…{me.slice(-4)}
              </span>
              <Button variant="secondary" onClick={() => disconnect()}>
                Rozłącz
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {connectors.length === 0 && (
                <span className="text-sm text-muted">
                  Zainstaluj portfel Solana (np. Phantom).
                </span>
              )}
              {connectors.map((c) => (
                <Button
                  key={c.id}
                  disabled={status === "connecting"}
                  onClick={() => connect(c.id)}
                >
                  Połącz: {c.name}
                </Button>
              ))}
            </div>
          )}
        </header>
        <nav className="flex flex-wrap gap-2 text-sm">
          {TABS.map((t) => (
            <a
              key={t.hash}
              href={t.hash}
              className={`rounded-full px-4 py-1.5 ${hash === t.hash ? "bg-foreground text-background" : "bg-cream"}`}
            >
              {t.label}
            </a>
          ))}
        </nav>
        {page}
      </main>
    </div>
  );
}
