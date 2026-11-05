"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import type { HealthResponse } from "@/types/api";

export function useBackendHealth() {
  return useQuery({
    queryKey: ["backend-health"],
    queryFn: () => apiRequest<HealthResponse>("/api/v1/health"),
    retry: false,
    refetchInterval: 30_000,
  });
}
