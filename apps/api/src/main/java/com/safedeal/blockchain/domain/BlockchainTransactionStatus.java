package com.safedeal.blockchain.domain;

/**
 * Lifecycle of a transaction we submitted to a chain.
 *
 * <ul>
 *   <li>{@code SUBMITTED} — broadcast accepted by the RPC node; tx hash known, not yet in a block.</li>
 *   <li>{@code PENDING} — seen in the mempool / receipt not yet available or block not final.</li>
 *   <li>{@code CONFIRMED} — receipt succeeded (status 1) and expected contract event was verified.</li>
 *   <li>{@code FAILED} — reverted, dropped, or event mismatch. Never treated as payment success.</li>
 * </ul>
 */
public enum BlockchainTransactionStatus {
    SUBMITTED,
    PENDING,
    CONFIRMED,
    FAILED;

    public boolean isTerminal() {
        return this == CONFIRMED || this == FAILED;
    }
}
