import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { avalancheFuji } from "viem/chains";
import { env } from "./env";

/**
 * Wallet configuration. Fuji is the only chain the app talks to during development; adding
 * mainnet later means adding a chain entry plus a matching contract-address set in env.
 */
export const wagmiConfig = createConfig({
  chains: [avalancheFuji],
  connectors: [injected()],
  transports: {
    [avalancheFuji.id]: http(env.rpcUrl),
  },
  ssr: true,
});
