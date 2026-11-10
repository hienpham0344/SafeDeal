package com.safedeal.infrastructure.configuration;

import jakarta.annotation.PostConstruct;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "safedeal.blockchain")
public class BlockchainProperties {

    private boolean enabled = true;
    @Min(1)
    private long chainId = 31337;
    @NotBlank
    private String chainName = "Anvil Local";
    private String rpcUrl = "http://127.0.0.1:8545";
    private String escrowContractAddress = "";
    @Min(0)
    private long deploymentBlock = 0;
    @Min(1)
    private int confirmationsRequired = 1;
    @Min(1)
    private long syncBatchSize = 1000;
    @Min(500)
    private long pollIntervalMs = 10000;
    @Min(1000)
    private long rpcTimeoutMs = 10000;

    @PostConstruct
    void validateStartup() {
        if (enabled) {
            if (rpcUrl == null || (!rpcUrl.startsWith("http://") && !rpcUrl.startsWith("https://"))) {
                throw new IllegalStateException("AVALANCHE_RPC_URL must be an http/https URL when blockchain is enabled");
            }
            if (escrowContractAddress == null || !escrowContractAddress.matches("^0x[0-9a-fA-F]{40}$")
                || "0x0000000000000000000000000000000000000000".equalsIgnoreCase(escrowContractAddress)) {
                throw new IllegalStateException(
                    "ESCROW_CONTRACT_ADDRESS must be configured as a valid non-zero EVM contract address when blockchain is enabled"
                );
            }
        }
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public long getChainId() {
        return chainId;
    }

    public void setChainId(long chainId) {
        this.chainId = chainId;
    }

    public String getChainName() {
        return chainName;
    }

    public void setChainName(String chainName) {
        this.chainName = chainName;
    }

    public String getRpcUrl() {
        return rpcUrl;
    }

    public void setRpcUrl(String rpcUrl) {
        this.rpcUrl = rpcUrl;
    }

    public String getEscrowContractAddress() {
        return escrowContractAddress == null ? "" : escrowContractAddress.trim();
    }

    public void setEscrowContractAddress(String escrowContractAddress) {
        this.escrowContractAddress = escrowContractAddress;
    }

    public long getDeploymentBlock() {
        return deploymentBlock;
    }

    public void setDeploymentBlock(long deploymentBlock) {
        this.deploymentBlock = deploymentBlock;
    }

    public int getConfirmationsRequired() {
        return confirmationsRequired;
    }

    public void setConfirmationsRequired(int confirmationsRequired) {
        this.confirmationsRequired = confirmationsRequired;
    }

    public long getSyncBatchSize() {
        return syncBatchSize;
    }

    public void setSyncBatchSize(long syncBatchSize) {
        this.syncBatchSize = syncBatchSize;
    }

    public long getPollIntervalMs() {
        return pollIntervalMs;
    }

    public void setPollIntervalMs(long pollIntervalMs) {
        this.pollIntervalMs = pollIntervalMs;
    }

    public long getRpcTimeoutMs() {
        return rpcTimeoutMs;
    }

    public void setRpcTimeoutMs(long rpcTimeoutMs) {
        this.rpcTimeoutMs = rpcTimeoutMs;
    }
}
