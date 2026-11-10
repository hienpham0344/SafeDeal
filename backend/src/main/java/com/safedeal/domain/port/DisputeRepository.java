package com.safedeal.domain.port;

import com.safedeal.domain.dispute.Dispute;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface DisputeRepository {
    Dispute save(Dispute dispute);

    Optional<Dispute> findById(Long id);

    Optional<Dispute> findByTradeId(String tradeId);

    Map<String, Long> findDisputeIdsByTradeIds(Collection<String> tradeIds);

    List<Dispute> findAssignedToArbiter(String arbiterAddress);
}
