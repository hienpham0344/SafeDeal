package com.safedeal.ai.domain;

/**
 * Summarizes dispute evidence for human arbiters. Strictly advisory: the interface deliberately
 * exposes no way to release or refund funds.
 */
public interface DisputeEvidenceAnalyzer {

    String summarize(String evidenceDescription);
}
