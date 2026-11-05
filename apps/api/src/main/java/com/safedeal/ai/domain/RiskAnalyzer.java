package com.safedeal.ai.domain;

/** Scores risk of a deal or agreement. Result informs users and arbiters; it never moves funds. */
public interface RiskAnalyzer {

    RiskAssessment analyze(String dealDescription);

    enum RiskLevel { LOW, MEDIUM, HIGH }

    record RiskAssessment(RiskLevel level, String rationale) {
    }
}
