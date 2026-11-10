import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { shouldRetryQueryError } from "@/services/http/api-client";
import { wagmiConfig } from "@/services/blockchain/wagmi";
import { AuthSessionProvider } from "@/features/authentication/components/AuthSessionProvider";
import { WalletModal } from "@/components/wallet/WalletModal";

export function AppProviders({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            retry: shouldRetryQueryError,
          },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>
          {children}
          <WalletModal />
        </AuthSessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
