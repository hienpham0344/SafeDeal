import { env } from "./env";

export const appConfig = {
  appName: env.appName,
  environment: env.appEnv,
  pagination: {
    defaultPageSize: 20,
  },
  escrow: {
    defaultInspectionWindowSeconds: env.defaultInspectionWindowSeconds,
    maxTitleLength: 160,
    maxDescriptionLength: 4000,
    maxTermsLength: 8000,
    nativeSymbol: "AVAX",
  },
  evidence: {
    maxBytes: env.maxEvidenceBytes,
    allowedMimeTypes: ["image/png", "image/jpeg", "application/pdf", "text/plain"] as const,
  },
  transactions: {
    pollIntervalMs: env.txPollIntervalMs,
    pendingStoragePrefix: "safedeal:pending-tx:",
    createDraftStoragePrefix: "safedeal:create-draft:",
  },
  messages: {
    walletRequired: "Connect your wallet to continue.",
    authRequired: "Sign the verification message to authenticate your wallet session.",
    wrongNetwork: `Switch your wallet network to ${env.chainName} (Chain ID ${env.chainId}).`,
    contractUnconfigured:
      "Escrow contract address is not configured. Set VITE_ESCROW_CONTRACT_ADDRESS in your environment.",
    genericError: "Something went wrong. Please retry or check service status.",
  },
} as const;
