import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { activeChain } from "@/config/network.config";
import { env } from "@/config/env";

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: {
    [activeChain.id]: http(env.rpcUrl),
  },
});
