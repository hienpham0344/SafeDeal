"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/Button";

export function ConnectWallet() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="font-mono">
          {address?.slice(0, 6)}…{address?.slice(-4)}
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">chain {chainId}</span>
        <Button variant="secondary" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {connectors.map((connector) => (
        <Button key={connector.uid} onClick={() => connect({ connector })} disabled={isPending}>
          Connect {connector.name}
        </Button>
      ))}
    </div>
  );
}
