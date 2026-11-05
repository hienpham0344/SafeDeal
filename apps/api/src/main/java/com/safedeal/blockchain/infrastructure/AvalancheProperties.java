package com.safedeal.blockchain.infrastructure;

import com.safedeal.blockchain.domain.BlockchainNetwork;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Avalanche integration settings. All addresses come from environment variables.
 *
 * @param rpcUrl         Fuji RPC endpoint (e.g. https://api.avax-test.network/ext/bc/C/rpc)
 * @param chainId        chain id, 43113 for Fuji
 * @param confirmations  number of blocks required before a transaction is CONFIRMED
 * @param contracts      contract addresses keyed by contract name (escrowManager, subscriptionManager, disputeResolver, paymentToken)
 */
@ConfigurationProperties(prefix = "safedeal.blockchain")
public record AvalancheProperties(
        BlockchainNetwork network,
        String rpcUrl,
        long chainId,
        int confirmations,
        Map<String, String> contracts) {

    public AvalancheProperties {
        confirmations = confirmations <= 0 ? 1 : confirmations;
        contracts = contracts == null ? Map.of() : Map.copyOf(contracts);
    }
}
