"use client";

import { Card } from "@/components/ui/Card";
import { useBackendHealth } from "@/hooks/use-health";

export function BackendStatus() {
  const health = useBackendHealth();

  const label = health.isLoading ? "checking…" : health.isError ? "unreachable" : (health.data?.status ?? "unknown");
  const tone = health.isError ? "text-red-600" : health.isLoading ? "text-slate-500" : "text-emerald-600";

  return (
    <Card title="Backend">
      <p className={`text-sm font-medium ${tone}`}>API status: {label}</p>
      {health.isError ? (
        <p className="mt-2 text-xs text-slate-500">
          Start the backend with <code>cd apps/api &amp;&amp; ./mvnw spring-boot:run</code>.
        </p>
      ) : null}
    </Card>
  );
}
