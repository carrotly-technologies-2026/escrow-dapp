import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { createWalletTransactionSigner } from "@solana/client";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import {
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  devnet,
  getBase58Encoder,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from "@solana/kit";
import { RPC_URL } from "../config";

export type DemoRole = "buyer" | "seller" | "arbiter";

export const DEMO_ROLE_LABEL: Record<DemoRole, string> = {
  buyer: "Kupujący",
  seller: "Sprzedający",
  arbiter: "Arbiter",
};

/** Who is acting right now: a Phantom wallet or one of the built-in demo wallets. */
export type Identity = {
  address: Address;
  signer: TransactionSigner;
  demoRole: DemoRole | null;
  send(ix: Instruction): Promise<string>;
};

type Ctx = {
  identity: Identity | null;
  demoRoles: DemoRole[];
  demoRole: DemoRole | null;
  setDemoRole(role: DemoRole | null): void;
};

const IdentityContext = createContext<Ctx | null>(null);

// Demo wallets are devnet-only keys baked into the build, enabled per deployment via env.
// They let a live demo switch between buyer, seller and arbiter with one click.
const DEMO_KEYS: Partial<Record<DemoRole, string>> = Object.fromEntries(
  (
    [
      ["buyer", import.meta.env.VITE_DEMO_BUYER_KEY],
      ["seller", import.meta.env.VITE_DEMO_SELLER_KEY],
      ["arbiter", import.meta.env.VITE_DEMO_ARBITER_KEY],
    ] as const
  ).filter(([, key]) => key)
);

// Typed as devnet so kit's send-and-confirm accepts it; the app only targets devnet.
const rpc = createSolanaRpc(devnet(RPC_URL));
const rpcSubscriptions = createSolanaRpcSubscriptions(
  devnet(RPC_URL.replace(/^http/, "ws"))
);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions,
});

async function sendWithKeypair(signer: KeyPairSigner, ix: Instruction) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstruction(ix, m)
  );
  const tx = await signTransactionMessageWithSigners(message);
  await sendAndConfirm(tx as Parameters<typeof sendAndConfirm>[0], {
    commitment: "confirmed",
  });
  return getSignatureFromTransaction(tx);
}

export function IdentityProvider({ children }: PropsWithChildren) {
  const { wallet } = useWalletConnection();
  const { send } = useSendTransaction();
  const [demoSigners, setDemoSigners] = useState<
    Partial<Record<DemoRole, KeyPairSigner>>
  >({});
  const [demoRole, setDemoRoleState] = useState<DemoRole | null>(() =>
    readStoredRole()
  );

  useEffect(() => {
    Promise.all(
      Object.entries(DEMO_KEYS).map(async ([role, key]) => [
        role,
        await createKeyPairSignerFromBytes(getBase58Encoder().encode(key!)),
      ])
    )
      .then((entries) => setDemoSigners(Object.fromEntries(entries)))
      .catch((err) => console.error("Invalid demo wallet key", err));
  }, []);

  const setDemoRole = useCallback((role: DemoRole | null) => {
    setDemoRoleState(role);
    try {
      if (role) localStorage.setItem("demoRole", role);
      else localStorage.removeItem("demoRole");
    } catch {
      // Storage may be unavailable (private mode); the choice just won't persist.
    }
  }, []);

  // Without a connected wallet there is nothing to act as, so fall back to the
  // demo buyer: the app is usable straight away, no extension needed.
  const activeRole: DemoRole | null =
    demoRole ?? (!wallet && demoSigners.buyer ? "buyer" : null);

  const identity = useMemo<Identity | null>(() => {
    const demoRole = activeRole;
    const demoSigner = demoRole ? demoSigners[demoRole] : undefined;
    if (demoRole && demoSigner) {
      return {
        address: demoSigner.address,
        signer: demoSigner,
        demoRole,
        send: (ix) => sendWithKeypair(demoSigner, ix),
      };
    }
    if (wallet) {
      // The same signer object must sign the instruction and pay the fee; two distinct
      // signer objects for one address make kit reject the transaction.
      const signer = createWalletTransactionSigner(wallet).signer;
      return {
        address: wallet.account.address,
        signer,
        demoRole: null,
        send: (ix) => send({ instructions: [ix], authority: signer }),
      };
    }
    return null;
  }, [activeRole, demoSigners, wallet, send]);

  const value = useMemo(
    () => ({
      identity,
      demoRoles: Object.keys(DEMO_KEYS) as DemoRole[],
      demoRole: activeRole,
      setDemoRole,
    }),
    [identity, activeRole, setDemoRole]
  );
  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity() {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used inside IdentityProvider");
  return ctx;
}

function readStoredRole(): DemoRole | null {
  try {
    const role = localStorage.getItem("demoRole");
    return role && role in DEMO_KEYS ? (role as DemoRole) : null;
  } catch {
    return null;
  }
}
