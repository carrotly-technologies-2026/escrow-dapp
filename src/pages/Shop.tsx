import { useEffect, useState, type FormEvent } from "react";
import { isAddress, type Address } from "@solana/kit";
import { DEFAULT_ARBITER, SHOP_SELLER } from "../config";
import { formatSol, LAMPORTS_PER_SOL } from "../lib/escrow";
import { useCreateEscrow } from "../lib/useCreateEscrow";
import { TxResult } from "../ui";

type Kind = "tshirt" | "hoodie" | "mug" | "cap" | "tote" | "stickers";
type Product = {
  id: string;
  name: string;
  kind: Kind;
  color: string;
  price: bigint;
  description: string;
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
    description:
      "Gruba bawełna, luźny krój i logo HY26 na piersi. Przetrwa 24 godziny kodowania.",
  },
  {
    id: "hoodie",
    name: "Bluza HackYeah",
    kind: "hoodie",
    color: "#1f2937",
    price: SOL(0.3),
    sizes: CLOTHES,
    description:
      "Ciepła bluza z kapturem na nocne debugowanie. Kieszeń mieści laptopa… prawie.",
  },
  {
    id: "mug",
    name: "Kubek „Deploy w piątek”",
    kind: "mug",
    color: "#db2777",
    price: SOL(0.05),
    description: "Ceramiczny kubek 330 ml. Na kawę przed deployem i melisę po.",
  },
  {
    id: "cap",
    name: "Czapka HackYeah",
    kind: "cap",
    color: "#0ea5e9",
    price: SOL(0.08),
    description: "Bawełniana czapka z daszkiem i regulowanym paskiem.",
  },
  {
    id: "tote",
    name: "Torba HackYeah",
    kind: "tote",
    color: "#16a34a",
    price: SOL(0.06),
    description: "Płócienna torba na laptopa, ładowarki i darmowe naklejki.",
  },
  {
    id: "stickers",
    name: "Paczka naklejek",
    kind: "stickers",
    color: "#f59e0b",
    price: SOL(0.02),
    description: "Dziesięć winylowych naklejek na laptopa. Odporne na kawę.",
  },
];

export function Shop({ onOrdered }: { onOrdered: (escrow: Address) => void }) {
  const [selected, setSelected] = useState<Product | null>(null);

  // A product page replaces the catalogue, so start it at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [selected]);

  if (selected) {
    return (
      <ProductPage
        product={selected}
        onBack={() => setSelected(null)}
        onOrdered={onOrdered}
      />
    );
  }

  return (
    <section className="space-y-8 py-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted">
            HackYeah Store
          </p>
          <h1 className="mt-1 text-2xl font-normal">Wszystkie produkty</h1>
        </div>
        <p className="max-w-sm text-sm text-muted">
          Płacisz jak w zwykłym sklepie — pieniądze trzyma escrow na Solanie,
          dopóki paczka nie dotrze.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-3">
        {PRODUCTS.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => setSelected(p)}
              className="group w-full cursor-pointer text-left"
            >
              <ProductArt product={p} />
              <div className="mt-3 flex justify-between gap-2 text-sm">
                <span>{p.name}</span>
                <span className="shrink-0 text-muted">
                  {formatSol(p.price)}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProductPage({
  product,
  onBack,
  onOrdered,
}: {
  product: Product;
  onBack: () => void;
  onOrdered: (escrow: Address) => void;
}) {
  const { create, signer, isSending, signature, error } = useCreateEscrow();
  const [size, setSize] = useState(product.sizes ? "" : "-");
  const [recipientName, setRecipientName] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");

  const arbiterConfigured = isAddress(DEFAULT_ARBITER);
  const title = product.sizes ? `${product.name} (${size})` : product.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!arbiterConfigured || !size) return;
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
    <section className="space-y-6 py-4">
      <button
        onClick={onBack}
        className="cursor-pointer text-sm text-muted hover:text-foreground"
      >
        ← Wszystkie produkty
      </button>
      <div className="grid gap-10 md:grid-cols-[1fr_minmax(0,380px)]">
        <ProductArt product={product} large />
        <form className="flex flex-col gap-6" onSubmit={submit}>
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-widest text-muted">
              HackYeah 2026
            </p>
            <h1 className="text-3xl font-normal leading-tight">
              {product.name}
            </h1>
            <p className="text-sm leading-relaxed text-muted">
              {product.description}
            </p>
          </div>

          {product.sizes && (
            <div className="space-y-2">
              <p className="text-sm">Wybierz rozmiar</p>
              <div className="grid grid-cols-4 gap-2">
                {product.sizes.map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => setSize(s)}
                    className={`h-10 cursor-pointer rounded-md border text-sm transition ${
                      size === s
                        ? "border-foreground bg-card font-medium"
                        : "border-border-low bg-cream hover:border-border-strong"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm">Dostawa</p>
            <input
              required
              maxLength={200}
              aria-label="Imię i nazwisko odbiorcy"
              placeholder="Imię i nazwisko"
              className={shopInput}
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
            />
            <input
              required
              maxLength={200}
              aria-label="Adres dostawy"
              placeholder="Adres dostawy"
              className={shopInput}
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <p className="text-2xl">{formatSol(product.price)}</p>
            {signer ? (
              <button
                type="submit"
                disabled={isSending || !arbiterConfigured || !size}
                className="h-11 w-full cursor-pointer rounded-md bg-foreground text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSending
                  ? "Podpisywanie…"
                  : !size
                    ? "Wybierz rozmiar"
                    : "Kup bezpiecznie przez escrow"}
              </button>
            ) : (
              <p className="rounded-md bg-cream p-3 text-sm text-muted">
                Wybierz rolę „Kupujący” albo podłącz Phantoma (prawy górny róg),
                aby złożyć zamówienie.
              </p>
            )}
            {!arbiterConfigured && (
              <p className="text-sm text-red-600">
                Sklep nie ma skonfigurowanego arbitra (VITE_DEFAULT_ARBITER).
              </p>
            )}
            <TxResult signature={signature} error={error} />
          </div>

          <div className="space-y-2 border-t border-border-low pt-6 text-xs leading-relaxed text-muted">
            <p>
              <span className="text-foreground">Ochrona kupującego.</span>{" "}
              Pieniądze trafiają do programu na Solanie, nie do sklepu. Sklep
              dostaje je dopiero, gdy potwierdzisz odbiór.
            </p>
            <p>
              Sklep ma 5 min na wysyłkę, Ty 5 min na potwierdzenie albo spór,
              arbiter 10 min na decyzję (terminy skrócone na potrzeby demo).
            </p>
          </div>
        </form>
      </div>
    </section>
  );
}

const shopInput =
  "h-10 w-full rounded-md border border-border-low bg-cream px-3 text-sm outline-none placeholder:text-muted focus:border-foreground";

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

/** Product "photo": a flat illustration on a neutral tile, Medusa-style. */
function ProductArt({ product, large }: { product: Product; large?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-xl bg-cream ${
        large ? "aspect-square" : "aspect-[11/14]"
      }`}
    >
      <svg
        viewBox="0 0 120 120"
        className={`transition duration-300 ${large ? "w-2/3" : "w-3/5 group-hover:scale-105"}`}
        role="img"
        aria-label={product.name}
      >
        <path d={ART[product.kind]} fill={product.color} fillRule="evenodd" />
        {product.kind !== "stickers" && (
          <text
            x="60"
            y={product.kind === "cap" ? 64 : 72}
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill="white"
          >
            HY26
          </text>
        )}
      </svg>
    </div>
  );
}
