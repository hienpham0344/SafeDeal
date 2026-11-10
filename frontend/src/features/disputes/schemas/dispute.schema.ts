import { z } from "zod";
import { appConfig } from "@/config/app.config";

export const openDisputeSchema = z.object({
  reason: z.string().trim().min(5, "Dispute reason must be at least 5 characters").max(200),
  summary: z.string().trim().min(10, "Provide a clear summary of the issue").max(4000),
});

export const submitEvidenceSchema = z.object({
  title: z.string().trim().min(3, "Evidence title is required").max(160),
  notes: z.string().trim().min(5, "Describe what this evidence demonstrates").max(4000),
});

export function validateEvidenceFile(file: File | null | undefined): string | null {
  if (!file) return null;
  if (file.size <= 0) {
    return "Attached file cannot be empty (0 bytes).";
  }
  if (file.size > appConfig.evidence.maxBytes) {
    return `Attachment exceeds maximum size of ${Math.round(appConfig.evidence.maxBytes / (1024 * 1024))} MB.`;
  }
  const allowed: readonly string[] = appConfig.evidence.allowedMimeTypes;
  if (!allowed.includes(file.type)) {
    return "Unsupported file type. Allowed: PNG, JPEG, PDF, or plain text.";
  }
  return null;
}

export type OpenDisputeFormValues = z.infer<typeof openDisputeSchema>;
export type SubmitEvidenceFormValues = z.infer<typeof submitEvidenceSchema>;
