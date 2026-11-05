package com.safedeal.ai.domain;

/** Turns negotiation text into a structured agreement draft. Output is advisory; humans approve. */
public interface AgreementExtractor {

    AgreementDraft extract(String negotiationTranscript);

    record AgreementDraft(String summary, String terms) {
    }
}
