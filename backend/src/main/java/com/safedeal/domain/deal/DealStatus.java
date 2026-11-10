package com.safedeal.domain.deal;

import com.safedeal.shared.exception.ValidationException;
import java.util.ArrayDeque;
import java.util.EnumSet;
import java.util.Queue;
import java.util.Set;

public enum DealStatus {
    DRAFT,
    CREATED,
    FUNDED,
    DELIVERED,
    RELEASED,
    REFUNDED,
    DISPUTED,
    RESOLVED,
    CANCELLED;

    public boolean isSettled() {
        return this == RELEASED || this == REFUNDED || this == RESOLVED || this == CANCELLED;
    }

    public boolean canTransitionTo(DealStatus next) {
        if (this == next) {
            return true;
        }
        return allowedNextStates().contains(next);
    }

    /**
     * Checks forward reachability along valid SafeDealEscrow contract paths.
     * Allows authoritative chain sync/indexing to catch up across skipped intermediate
     * off-chain sync calls while rejecting backwards, post-settlement, or invalid branch jumps.
     */
    public boolean canReconcileTo(DealStatus target) {
        if (this == target) {
            return true;
        }
        EnumSet<DealStatus> visited = EnumSet.of(this);
        Queue<DealStatus> queue = new ArrayDeque<>();
        queue.add(this);
        while (!queue.isEmpty()) {
            DealStatus cursor = queue.poll();
            for (DealStatus next : cursor.allowedNextStates()) {
                if (next == target) {
                    return true;
                }
                if (visited.add(next)) {
                    queue.add(next);
                }
            }
        }
        return false;
    }

    private Set<DealStatus> allowedNextStates() {
        return switch (this) {
            case DRAFT -> EnumSet.of(CREATED);
            case CREATED -> EnumSet.of(FUNDED, CANCELLED);
            case FUNDED -> EnumSet.of(DELIVERED, REFUNDED, DISPUTED);
            case DELIVERED -> EnumSet.of(RELEASED, DISPUTED);
            case DISPUTED -> EnumSet.of(RESOLVED);
            case RELEASED, REFUNDED, RESOLVED, CANCELLED -> EnumSet.noneOf(DealStatus.class);
        };
    }

    public static DealStatus fromChainOrdinal(int ordinal) {
        return switch (ordinal) {
            case 1 -> CREATED;
            case 2 -> FUNDED;
            case 3 -> DELIVERED;
            case 4 -> RELEASED;
            case 5 -> REFUNDED;
            case 6 -> DISPUTED;
            case 7 -> RESOLVED;
            case 8 -> CANCELLED;
            default -> throw new ValidationException("Invalid or uninitialized on-chain escrow status: " + ordinal);
        };
    }
}
