package com.safedeal.domain.port;

import com.safedeal.domain.deal.DealEvent;
import java.util.List;

public interface DealEventRepository {
    boolean saveIfAbsent(DealEvent event);

    List<DealEvent> findByTradeIdOrderByCreatedAtAsc(String tradeId);
}
