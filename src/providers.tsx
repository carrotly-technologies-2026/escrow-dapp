import { SolanaProvider } from "@solana/react-hooks";
import { PropsWithChildren } from "react";
import { autoDiscover, createClient } from "@solana/client";
import { RPC_URL } from "./config";
import { IdentityProvider } from "./lib/identity";

const client = createClient({
  endpoint: RPC_URL,
  walletConnectors: autoDiscover(),
});

export function Providers({ children }: PropsWithChildren) {
  return (
    <SolanaProvider client={client}>
      <IdentityProvider>{children}</IdentityProvider>
    </SolanaProvider>
  );
}
