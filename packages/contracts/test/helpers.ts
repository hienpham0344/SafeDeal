export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const bytes32 = (byte: string) => ("0x" + byte.repeat(32)) as `0x${string}`;
export const ONE_USD = 1_000_000n; // MockPaymentToken has 6 decimals
