import { useEffect, useState, type FormEvent } from "react";
import { isAddress, type Address } from "@solana/kit";
import { DEFAULT_ARBITER, SHOP_SELLER } from "../config";
import { formatSol, LAMPORTS_PER_SOL } from "../lib/escrow";
import { useCreateEscrow } from "../lib/useCreateEscrow";
import { TxResult } from "../ui";

type Product = {
  id: string;
  name: string;
  image: string;
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
    image: "/products/tee.jpg",
    price: SOL(0.1),
    sizes: CLOTHES,
    description:
      "Gruba bawełna, luźny krój i małe logo na piersi. Przetrwa 24 godziny kodowania.",
  },
  {
    id: "sweatshirt",
    name: "Bluza HackYeah",
    image: "/products/sweatshirt.jpg",
    price: SOL(0.3),
    sizes: CLOTHES,
    description:
      "Ciepła bluza oversize na nocne debugowanie. Miękka w środku, sprana na zewnątrz.",
  },
  {
    id: "sweatpants",
    name: "Spodnie dresowe HackYeah",
    image: "/products/sweatpants.jpg",
    price: SOL(0.2),
    sizes: CLOTHES,
    description:
      "Wygodne dresy na całą noc przy laptopie. Ściągacze przy kostkach, dwie kieszenie.",
  },
  {
    id: "mug",
    name: "Kubek „Deploy w piątek”",
    image: "/products/mug.jpg",
    price: SOL(0.05),
    description: "Ceramiczny kubek 330 ml. Na kawę przed deployem i melisę po.",
  },
  {
    id: "cap",
    name: "Czapka HackYeah",
    image: "/products/cap.jpg",
    price: SOL(0.08),
    description: "Sprana bawełniana czapka z daszkiem i regulowanym paskiem.",
  },
  {
    id: "stickers",
    name: "Naklejka holograficzna",
    image: "/products/stickers.jpg",
    price: SOL(0.02),
    description:
      "Holograficzna naklejka na laptopa. Odporna na kawę i zarysowania.",
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

/** Product photo on a neutral tile, Medusa-style. */
function ProductArt({ product, large }: { product: Product; large?: boolean }) {
  return (
    <div
      className={`overflow-hidden rounded-xl bg-[#f5f5f5] ${
        large ? "aspect-[4/5]" : "aspect-[11/14]"
      }`}
    >
      <img
        src={product.image}
        alt={product.name}
        loading="lazy"
        className={`h-full w-full object-cover transition duration-300 ${large ? "" : "group-hover:scale-105"}`}
      />
    </div>
  );
}
