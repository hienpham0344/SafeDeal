import { Link } from "react-router-dom";
import { ArrowLeft, Compass } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Panel } from "@/components/ui/Primitives";
import { ROUTES } from "@/config/routes";

export function NotFoundPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-xl py-8">
        <Panel variant="elevated" className="space-y-5 p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-sd-lineStrong bg-sd-inset text-sd-accent">
              <Compass size={18} aria-hidden="true" />
            </div>
            <p className="font-mono text-xs uppercase tracking-wider text-sd-inkSubtle">
              404 // ROUTE_NOT_FOUND
            </p>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-white">Page not found</h1>
            <p className="text-sm leading-relaxed text-sd-inkMuted">
              The route you requested does not exist on SafeDeal or the escrow reference is malformed.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-sd-line pt-5">
            <Link
              to={ROUTES.dashboard}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-[#09090b] transition-colors hover:bg-white/90"
            >
              Open My Deals
            </Link>
            <Link
              to={ROUTES.home}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-sd-lineStrong bg-sd-inset px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/30 hover:bg-sd-surface"
            >
              <ArrowLeft size={15} aria-hidden="true" />
              <span>Back to Home</span>
            </Link>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
