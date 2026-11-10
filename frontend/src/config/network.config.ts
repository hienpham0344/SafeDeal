import { defineChain } from "viem";
import { env } from "./env";

export const activeChain = defineChain({
  id: env.chainId,
  name: env.chainName,
  nativeCurrency: {
    name: "Avalanche",
    symbol: "AVAX",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [env.rpcUrl],
    },
  },
  ...(env.explorerBaseUrl
    ? {
        blockExplorers: {
          default: {
            name: "Snowtrace",
            url: env.explorerBaseUrl,
          },
        },
      }
    : {}),
  testnet: true,
});

export function getExplorerTxUrl(txHash: string): string | null {
  if (!env.explorerBaseUrl) return null;
  return `${env.explorerBaseUrl}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string): string | null {
  if (!env.explorerBaseUrl) return null;
  return `${env.explorerBaseUrl}/address/${address}`;
}
