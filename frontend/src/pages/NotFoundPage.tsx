import { Link } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/Primitives";
import { ROUTES } from "@/config/routes";

export function NotFoundPage() {
  return (
    <AppShell>
      <EmptyState
        title="Page not found"
        description="The route you requested does not exist on SafeDeal."
        action={
          <Link
            to={ROUTES.home}
            className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black hover:bg-white/90"
          >
            Back to Home
          </Link>
        }
      />
    </AppShell>
  );
}
