import { z } from "zod";
import { appConfig } from "@/config/app.config";
import { parseAvaxToWei } from "@/utils/format";

const ETH_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function isNonZeroEthAddress(val: string): boolean {
  return ETH_ADDRESS_REGEX.test(val) && val.toLowerCase() !== ZERO_ADDRESS;
}

export const createDealSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, "Title must be at least 3 characters")
      .max(appConfig.escrow.maxTitleLength, `Title must be under ${appConfig.escrow.maxTitleLength} characters`),
    description: z
      .string()
      .trim()
      .min(10, "Description must be at least 10 characters")
      .max(
        appConfig.escrow.maxDescriptionLength,
        `Description must be under ${appConfig.escrow.maxDescriptionLength} characters`
      ),
    amountAvax: z
      .string()
      .trim()
      .refine((val) => parseAvaxToWei(val) !== null, "Enter a valid positive AVAX amount (up to 18 decimals)"),
    buyerAddress: z
      .string()
      .trim()
      .refine(
        (val) => val === "" || isNonZeroEthAddress(val),
        "Preassigned buyer must be a valid non-zero 0x address or left blank"
      ),
    arbiterAddress: z
      .string()
      .trim()
      .refine((val) => isNonZeroEthAddress(val), "Arbiter must be a valid non-zero 0x wallet address"),
    fundingDeadline: z.string().min(1, "Funding deadline is required"),
    deliveryDeadline: z.string().min(1, "Delivery deadline is required"),
    inspectionHours: z.coerce
      .number()
      .int("Inspection window must be a whole number of hours")
      .min(1, "Inspection window must be at least 1 hour")
      .max(720, "Inspection window cannot exceed 720 hours (30 days)"),
    terms: z
      .string()
      .trim()
      .min(10, "Terms and conditions must be at least 10 characters")
      .max(appConfig.escrow.maxTermsLength, `Terms must be under ${appConfig.escrow.maxTermsLength} characters`),
  })
  .superRefine((data, ctx) => {
    const fundingTs = Date.parse(data.fundingDeadline);
    const deliveryTs = Date.parse(data.deliveryDeadline);
    const now = Date.now();

    if (Number.isNaN(fundingTs) || fundingTs <= now + 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fundingDeadline"],
        message: "Funding deadline must be at least 1 minute in the future",
      });
    }
    if (Number.isNaN(deliveryTs) || deliveryTs <= fundingTs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deliveryDeadline"],
        message: "Delivery deadline must be strictly after funding deadline",
      });
    }
    if (
      data.buyerAddress &&
      data.arbiterAddress &&
      data.buyerAddress.toLowerCase() === data.arbiterAddress.toLowerCase()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["arbiterAddress"],
        message: "Arbiter cannot be the same address as the buyer",
      });
    }
  });

export type CreateDealFormValues = z.infer<typeof createDealSchema>;
