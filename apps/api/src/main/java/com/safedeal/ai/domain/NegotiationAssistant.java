package com.safedeal.ai.domain;

/** Suggests replies and clarifications during negotiation. */
public interface NegotiationAssistant {

    String suggestReply(String conversationContext);
}
