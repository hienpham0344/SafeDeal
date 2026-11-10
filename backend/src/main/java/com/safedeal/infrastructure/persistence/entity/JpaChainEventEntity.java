package com.safedeal.infrastructure.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "chain_events")
public class JpaChainEventEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tx_hash", nullable = false, length = 66)
    private String txHash;

    @Column(name = "log_index", nullable = false)
    private int logIndex;

    @Column(name = "block_number", nullable = false)
    private long blockNumber;

    @Column(name = "block_timestamp", nullable = false)
    private long blockTimestamp;

    @Column(name = "contract_address", nullable = false, length = 42)
    private String contractAddress;

    @Column(name = "event_type", nullable = false, length = 48)
    private String eventType;

    @Column(name = "trade_id", nullable = false, length = 66)
    private String tradeId;

    @Column(name = "actor_address", length = 42)
    private String actorAddress;

    @Column(name = "amount_wei", length = 78)
    private String amountWei;

    @Column(name = "buyer_award_wei", length = 78)
    private String buyerAwardWei;

    @Column(name = "seller_award_wei", length = 78)
    private String sellerAwardWei;

    @Column(name = "terms_hash", length = 66)
    private String termsHash;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getTxHash() {
        return txHash;
    }

    public void setTxHash(String txHash) {
        this.txHash = txHash;
    }

    public int getLogIndex() {
        return logIndex;
    }

    public void setLogIndex(int logIndex) {
        this.logIndex = logIndex;
    }

    public long getBlockNumber() {
        return blockNumber;
    }

    public void setBlockNumber(long blockNumber) {
        this.blockNumber = blockNumber;
    }

    public long getBlockTimestamp() {
        return blockTimestamp;
    }

    public void setBlockTimestamp(long blockTimestamp) {
        this.blockTimestamp = blockTimestamp;
    }

    public String getContractAddress() {
        return contractAddress;
    }

    public void setContractAddress(String contractAddress) {
        this.contractAddress = contractAddress;
    }

    public String getEventType() {
        return eventType;
    }

    public void setEventType(String eventType) {
        this.eventType = eventType;
    }

    public String getTradeId() {
        return tradeId;
    }

    public void setTradeId(String tradeId) {
        this.tradeId = tradeId;
    }

    public String getActorAddress() {
        return actorAddress;
    }

    public void setActorAddress(String actorAddress) {
        this.actorAddress = actorAddress;
    }

    public String getAmountWei() {
        return amountWei;
    }

    public void setAmountWei(String amountWei) {
        this.amountWei = amountWei;
    }

    public String getBuyerAwardWei() {
        return buyerAwardWei;
    }

    public void setBuyerAwardWei(String buyerAwardWei) {
        this.buyerAwardWei = buyerAwardWei;
    }

    public String getSellerAwardWei() {
        return sellerAwardWei;
    }

    public void setSellerAwardWei(String sellerAwardWei) {
        this.sellerAwardWei = sellerAwardWei;
    }

    public String getTermsHash() {
        return termsHash;
    }

    public void setTermsHash(String termsHash) {
        this.termsHash = termsHash;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
