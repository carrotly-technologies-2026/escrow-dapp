import { useEffect, useRef, useState, type FormEvent } from "react";
import { isAddress, type Address } from "@solana/kit";
import { DEFAULT_ARBITER, SHOP_SELLER } from "../config";
import { formatSol, LAMPORTS_PER_SOL } from "../lib/escrow";
import { useCreateEscrow } from "../lib/useCreateEscrow";
import { Button, Card, Field, TxResult, inputClass } from "../ui";

type Kind = "tshirt" | "hoodie" | "mug" | "cap" | "tote" | "stickers";
type Product = {
  id: string;
  name: string;
  kind: Kind;
  color: string;
  price: bigint;
  sizes?: string[];
};

const SOL = (n: number) => BigInt(Math.round(n * Number(LAMPORTS_PER_SOL)));
const CLOTHES = ["S", "M", "L", "XL"];

// Mock catalogue: the shop exists to show how a store plugs escrow into checkout.
const PRODUCTS: Product[] = [
  {
    id: "tee",
    name: "Koszulka HackYeah 2026",
    kind: "tshirt",
    color: "#7c3aed",
    price: SOL(0.1),
    sizes: CLOTHES,
  },
  {
    id: "hoodie",
    name: "Bluza HackYeah",
    kind: "hoodie",
    color: "#111827",
    price: SOL(0.3),
    sizes: CLOTHES,
  },
  {
    id: "mug",
    name: "Kubek „Deploy w piątek”",
    kind: "mug",
    color: "#db2777",
    price: SOL(0.05),
  },
  {
    id: "cap",
    name: "Czapka HackYeah",
    kind: "cap",
    color: "#0ea5e9",
    price: SOL(0.08),
  },
  {
    id: "tote",
    name: "Torba HackYeah",
    kind: "tote",
    color: "#16a34a",
    price: SOL(0.06),
  },
  {
    id: "stickers",
    name: "Paczka naklejek",
    kind: "stickers",
    color: "#f59e0b",
    price: SOL(0.02),
  },
];

export function Shop({ onOrdered }: { onOrdered: (escrow: Address) => void }) {
  const [selected, setSelected] = useState<Product | null>(null);

  return (
    <div className="space-y-6">
      <Card
        title="Sklep HackYeah — merch"
        aside={
          <span className="text-xs text-muted">
            sklep demonstracyjny · devnet
          </span>
        }
      >
        <p className="text-sm text-muted">
          Płacisz jak w zwykłym sklepie, ale pieniądze nie trafiają do sklepu.
          Trzyma je program escrow na Solanie, dopóki nie potwierdzisz, że
          paczka dotarła.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className={`cursor-pointer space-y-2 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${
                selected?.id === p.id
                  ? "border-foreground"
                  : "border-border-low"
              }`}
            >
              <ProductArt kind={p.kind} color={p.color} />
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-muted">{formatSol(p.price)}</p>
            </button>
          ))}
        </div>
      </Card>
      {selected && (
        <Checkout key={selected.id} product={selected} onOrdered={onOrdered} />
      )}
    </div>
  );
}

function Checkout({
  product,
  onOrdered,
}: {
  product: Product;
  onOrdered: (escrow: Address) => void;
}) {
  const { create, signer, isSending, signature, error } = useCreateEscrow();
  const [size, setSize] = useState(product.sizes?.[1] ?? "");
  const [recipientName, setRecipientName] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");

  const ref = useRef<HTMLDivElement>(null);
  // The form renders below the catalogue; bring it into view on selection.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const arbiterConfigured = isAddress(DEFAULT_ARBITER);
  const title = size ? `${product.name} (${size})` : product.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!arbiterConfigured) return;
    const escrow = await create({
      seller: SHOP_SELLER,
      arbiter: DEFAULT_ARBITER as Address,
      amount: product.price,
      details: { itemTitle: title, recipientName, recipientAddress },
      preset: "demo",
    });
    if (escrow) onOrdered(escrow);
  }

  return (
    <div ref={ref} className="scroll-mt-4">
      <Card
        title={`Zamówienie: ${title}`}
        aside={
          <span className="font-semibold">{formatSol(product.price)}</span>
        }
      >
        {!signer ? (
          <p className="text-sm text-muted">
            Wybierz rolę „Kupujący” albo podłącz Phantoma (prawy górny róg), aby
            złożyć zamówienie.
          </p>
        ) : (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            {product.sizes && (
              <Field label="Rozmiar">
                <select
                  className={inputClass}
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                >
                  {product.sizes.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Imię i nazwisko odbiorcy">
              <input
                required
                maxLength={200}
                className={inputClass}
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
              />
            </Field>
            <Field label="Adres dostawy">
              <input
                required
                maxLength={200}
                className={inputClass}
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                placeholder="ul. Przykładowa 1, 00-001 Kraków"
              />
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <Button
                type="submit"
                disabled={isSending || !arbiterConfigured}
                className="w-full"
              >
                {isSending
                  ? "Podpisywanie w portfelu…"
                  : `Kup bezpiecznie przez escrow — ${formatSol(product.price)}`}
              </Button>
              <p className="text-xs text-muted">
                Sklep ma 5 min na wysyłkę (inaczej pieniądze wracają do Ciebie),
                a Ty 5 min na potwierdzenie odbioru albo otwarcie sporu (arbiter
                ma 10 min na decyzję). Terminy skrócone na potrzeby demo.
              </p>
              {!arbiterConfigured && (
                <p className="text-sm text-red-600">
                  Sklep nie ma skonfigurowanego arbitra (VITE_DEFAULT_ARBITER).
                </p>
              )}
            </div>
          </form>
        )}
        <TxResult signature={signature} error={error} />
      </Card>
    </div>
  );
}

const ART: Record<Kind, string> = {
  tshirt:
    "M30 20 L45 12 Q60 22 75 12 L90 20 L104 40 L90 48 L86 42 L86 100 L34 100 L34 42 L30 48 L16 40 Z",
  hoodie:
    "M30 24 L46 14 Q60 34 74 14 L90 24 L106 74 L92 78 L86 52 L86 104 L34 104 L34 52 L28 78 L14 74 Z M46 14 Q60 4 74 14 Q60 34 46 14 Z",
  mug: "M30 30 L82 30 L82 96 Q82 104 74 104 L38 104 Q30 104 30 96 Z M82 44 Q102 44 102 62 Q102 80 82 80 L82 72 Q94 72 94 62 Q94 52 82 52 Z",
  cap: "M24 78 Q24 34 60 32 Q96 34 96 78 Z M60 78 L108 78 Q108 90 94 90 L60 90 Z",
  tote: "M26 46 L94 46 L90 106 L30 106 Z M42 46 Q42 18 60 18 Q78 18 78 46 L72 46 Q72 24 60 24 Q48 24 48 46 Z",
  stickers:
    "M20 40 a20 20 0 1 0 40 0 a20 20 0 1 0 -40 0 Z M62 28 L100 28 L100 66 L62 66 Z M34 74 L56 110 L12 110 Z M66 76 h34 v30 h-34 Z",
};

function ProductArt({ kind, color }: { kind: Kind; color: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-32 w-full rounded-lg bg-cream"
      role="img"
      aria-label={kind}
    >
      <path d={ART[kind]} fill={color} fillRule="evenodd" />
      <text
        x="60"
        y={kind === "cap" ? 64 : 72}
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill="white"
      >
        {kind === "stickers" ? "" : "HY26"}
      </text>
    </svg>
  );
}
