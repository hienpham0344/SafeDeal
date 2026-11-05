import { BackendStatus } from "@/features/health/BackendStatus";
import { WalletPanel } from "@/features/wallet/WalletPanel";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SafeDeal</h1>
        <p className="mt-1 text-sm text-slate-600">
          AI-assisted escrow on Avalanche — scaffold environment. Business features are not implemented yet.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <WalletPanel />
        <BackendStatus />
      </div>
    </div>
  );
}
