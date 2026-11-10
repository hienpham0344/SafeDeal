package com.safedeal.infrastructure.blockchain;

import com.safedeal.application.synchronization.BlockchainEventIndexerService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "safedeal.blockchain", name = "enabled", havingValue = "true")
public class BlockchainSyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(BlockchainSyncScheduler.class);

    private final BlockchainEventIndexerService indexerService;

    public BlockchainSyncScheduler(BlockchainEventIndexerService indexerService) {
        this.indexerService = indexerService;
    }

    @Scheduled(fixedDelayString = "${safedeal.blockchain.poll-interval-ms:10000}")
    public void runIndexerCycle() {
        try {
            indexerService.pollAndIndex();
        } catch (Exception ex) {
            log.warn("Scheduled blockchain sync cycle failed cleanly: {}", ex.getMessage());
        }
    }
}
