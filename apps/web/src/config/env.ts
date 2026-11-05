/**
 * Single place that reads public environment variables. Components import from here instead of
 * touching process.env so missing configuration is caught in one spot.
 */
const optionalAddress = (value: string | undefined): `0x${string}` | undefined =>
  value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as `0x${string}`) : undefined;

export const env = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113),
  rpcUrl: process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc",
  contracts: {
    escrowManager: optionalAddress(process.env.NEXT_PUBLIC_ESCROW_MANAGER_ADDRESS),
    subscriptionManager: optionalAddress(process.env.NEXT_PUBLIC_SUBSCRIPTION_MANAGER_ADDRESS),
    disputeResolver: optionalAddress(process.env.NEXT_PUBLIC_DISPUTE_RESOLVER_ADDRESS),
    paymentToken: optionalAddress(process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS),
  },
} as const;
