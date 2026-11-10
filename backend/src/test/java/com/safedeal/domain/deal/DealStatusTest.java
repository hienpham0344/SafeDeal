package com.safedeal.domain.deal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.safedeal.shared.exception.ValidationException;
import org.junit.jupiter.api.Test;

class DealStatusTest {

    @Test
    void permitsValidEscrowStateTransitions() {
        assertThat(DealStatus.DRAFT.canTransitionTo(DealStatus.CREATED)).isTrue();
        assertThat(DealStatus.CREATED.canTransitionTo(DealStatus.FUNDED)).isTrue();
        assertThat(DealStatus.CREATED.canTransitionTo(DealStatus.CANCELLED)).isTrue();
        assertThat(DealStatus.FUNDED.canTransitionTo(DealStatus.DELIVERED)).isTrue();
        assertThat(DealStatus.FUNDED.canTransitionTo(DealStatus.REFUNDED)).isTrue();
        assertThat(DealStatus.FUNDED.canTransitionTo(DealStatus.DISPUTED)).isTrue();
        assertThat(DealStatus.DELIVERED.canTransitionTo(DealStatus.RELEASED)).isTrue();
        assertThat(DealStatus.DELIVERED.canTransitionTo(DealStatus.DISPUTED)).isTrue();
        assertThat(DealStatus.DISPUTED.canTransitionTo(DealStatus.RESOLVED)).isTrue();
    }

    @Test
    void rejectsBackwardsOrPostSettlementTransitions() {
        assertThat(DealStatus.RELEASED.canTransitionTo(DealStatus.DISPUTED)).isFalse();
        assertThat(DealStatus.REFUNDED.canTransitionTo(DealStatus.RELEASED)).isFalse();
        assertThat(DealStatus.CANCELLED.canTransitionTo(DealStatus.FUNDED)).isFalse();
        assertThat(DealStatus.RESOLVED.canTransitionTo(DealStatus.FUNDED)).isFalse();
        assertThat(DealStatus.DISPUTED.canTransitionTo(DealStatus.FUNDED)).isFalse();
    }

    @Test
    void mapsSolidityEnumOrdinalsSafely() {
        assertThat(DealStatus.fromChainOrdinal(1)).isEqualTo(DealStatus.CREATED);
        assertThat(DealStatus.fromChainOrdinal(6)).isEqualTo(DealStatus.DISPUTED);
        assertThat(DealStatus.fromChainOrdinal(8)).isEqualTo(DealStatus.CANCELLED);
        assertThatThrownBy(() -> DealStatus.fromChainOrdinal(0)).isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> DealStatus.fromChainOrdinal(99)).isInstanceOf(ValidationException.class);
    }

    @Test
    void permitsForwardCatchUpAndRejectsInvalidCrossBranchReconciliation() {
        assertThat(DealStatus.DRAFT.canReconcileTo(DealStatus.FUNDED)).isTrue();
        assertThat(DealStatus.DRAFT.canReconcileTo(DealStatus.DISPUTED)).isTrue();
        assertThat(DealStatus.CREATED.canReconcileTo(DealStatus.DISPUTED)).isTrue();
        assertThat(DealStatus.CREATED.canReconcileTo(DealStatus.RELEASED)).isTrue();
        assertThat(DealStatus.FUNDED.canReconcileTo(DealStatus.CANCELLED)).isFalse();
        assertThat(DealStatus.DELIVERED.canReconcileTo(DealStatus.REFUNDED)).isFalse();
        assertThat(DealStatus.DISPUTED.canReconcileTo(DealStatus.RELEASED)).isFalse();
        assertThat(DealStatus.RELEASED.canReconcileTo(DealStatus.DISPUTED)).isFalse();
    }
}
