package com.safedeal.domain.port;

import com.safedeal.domain.blockchain.OnChainTradeSnapshot;
import com.safedeal.domain.blockchain.TransactionVerificationResult;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import java.util.List;
import java.util.Optional;

public interface BlockchainGateway {
    boolean isEnabled();

    long chainId();

    String chainName();

    String contractAddress();

    long deploymentBlock();

    int confirmationsRequired();

    long syncBatchSize();

    Optional<OnChainTradeSnapshot> fetchTrade(String tradeId);

    Optional<TransactionVerificationResult> inspectTransaction(String txHash);

    long fetchLatestBlockNumber();

    List<VerifiedChainEvent> fetchLogs(long fromBlock, long toBlock);
}
