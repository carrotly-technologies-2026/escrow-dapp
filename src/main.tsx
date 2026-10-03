// Must run first: browsers without native Ed25519 in WebCrypto (older Chrome,
// Safari) could not load the demo wallets or sign anything.
import { install } from "@solana/webcrypto-ed25519-polyfill";
install();
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "./providers";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>
);
