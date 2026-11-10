package com.safedeal.infrastructure.persistence.entity;

import com.safedeal.domain.dispute.DisputeStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "disputes")
public class JpaDisputeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "trade_id", nullable = false, unique = true, length = 66)
    private String tradeId;

    @Column(name = "opened_by", nullable = false, length = 42)
    private String openedBy;

    @Column(name = "reason", nullable = false, length = 200)
    private String reason;

    @Column(name = "summary", nullable = false, columnDefinition = "TEXT")
    private String summary;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 24)
    private DisputeStatus status;

    @Column(name = "buyer_award_wei", length = 78)
    private String buyerAwardWei;

    @Column(name = "seller_award_wei", length = 78)
    private String sellerAwardWei;

    @Column(name = "resolution_rationale", columnDefinition = "TEXT")
    private String resolutionRationale;

    @Column(name = "open_tx_hash", length = 66)
    private String openTxHash;

    @Column(name = "resolve_tx_hash", unique = true, length = 66)
    private String resolveTxHash;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getTradeId() {
        return tradeId;
    }

    public void setTradeId(String tradeId) {
        this.tradeId = tradeId;
    }

    public String getOpenedBy() {
        return openedBy;
    }

    public void setOpenedBy(String openedBy) {
        this.openedBy = openedBy;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public DisputeStatus getStatus() {
        return status;
    }

    public void setStatus(DisputeStatus status) {
        this.status = status;
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

    public String getResolutionRationale() {
        return resolutionRationale;
    }

    public void setResolutionRationale(String resolutionRationale) {
        this.resolutionRationale = resolutionRationale;
    }

    public String getOpenTxHash() {
        return openTxHash;
    }

    public void setOpenTxHash(String openTxHash) {
        this.openTxHash = openTxHash;
    }

    public String getResolveTxHash() {
        return resolveTxHash;
    }

    public void setResolveTxHash(String resolveTxHash) {
        this.resolveTxHash = resolveTxHash;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getResolvedAt() {
        return resolvedAt;
    }

    public void setResolvedAt(Instant resolvedAt) {
        this.resolvedAt = resolvedAt;
    }
}
