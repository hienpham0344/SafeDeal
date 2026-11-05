"use client";

import { Card } from "@/components/ui/Card";
import { ConnectWallet } from "./ConnectWallet";

export function WalletPanel() {
  return (
    <Card title="Wallet">
      <p className="mb-3 text-sm text-slate-600">
        Connect an Avalanche Fuji wallet. Signing a server-issued challenge will replace this
        read-only connection once the auth module is implemented.
      </p>
      <ConnectWallet />
    </Card>
  );
}
