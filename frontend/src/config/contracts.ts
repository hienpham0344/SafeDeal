import { env } from "./env";
import { safeDealEscrowAbi } from "@/contracts/SafeDealEscrow";

export const contractsConfig = {
  escrowAddress: env.escrowContractAddress,
  escrowAbi: safeDealEscrowAbi,
} as const;
