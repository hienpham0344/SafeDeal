package com.safedeal.infrastructure.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "chain_sync_state")
public class JpaChainSyncStateEntity {

    @Id
    @Column(name = "id", nullable = false)
    private Integer id;

    @Column(name = "chain_id", nullable = false)
    private long chainId;

    @Column(name = "contract_address", nullable = false, length = 42)
    private String contractAddress;

    @Column(name = "last_synced_block", nullable = false)
    private long lastSyncedBlock;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Integer getId() {
        return id;
    }

    public void setId(Integer id) {
        this.id = id;
    }

    public long getChainId() {
        return chainId;
    }

    public void setChainId(long chainId) {
        this.chainId = chainId;
    }

    public String getContractAddress() {
        return contractAddress;
    }

    public void setContractAddress(String contractAddress) {
        this.contractAddress = contractAddress;
    }

    public long getLastSyncedBlock() {
        return lastSyncedBlock;
    }

    public void setLastSyncedBlock(long lastSyncedBlock) {
        this.lastSyncedBlock = lastSyncedBlock;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
