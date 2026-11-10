package com.safedeal.infrastructure.persistence.entity;

import com.safedeal.domain.deal.DealStatus;
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
@Table(name = "deals")
public class JpaDealEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "trade_id", nullable = false, unique = true, length = 66)
    private String tradeId;

    @Column(name = "chain_id", nullable = false)
    private long chainId;

    @Column(name = "contract_address", nullable = false, length = 42)
    private String contractAddress;

    @Column(name = "seller_address", nullable = false, length = 42)
    private String sellerAddress;

    @Column(name = "buyer_address", length = 42)
    private String buyerAddress;

    @Column(name = "arbiter_address", nullable = false, length = 42)
    private String arbiterAddress;

    @Column(name = "amount_wei", nullable = false, length = 78)
    private String amountWei;

    @Column(name = "terms_hash", nullable = false, length = 66)
    private String termsHash;

    @Column(name = "funding_deadline", nullable = false)
    private Instant fundingDeadline;

    @Column(name = "delivery_deadline", nullable = false)
    private Instant deliveryDeadline;

    @Column(name = "inspection_window_seconds", nullable = false)
    private long inspectionWindowSeconds;

    @Column(name = "delivered_at")
    private Instant deliveredAt;

    @Column(name = "funded_at")
    private Instant fundedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 24)
    private DealStatus status;

    @Column(name = "on_chain_bound", nullable = false)
    private boolean onChainBound;

    @Column(name = "settled", nullable = false)
    private boolean settled;

    @Column(name = "create_tx_hash", unique = true, length = 66)
    private String createTxHash;

    @Column(name = "buyer_award_wei", length = 78)
    private String buyerAwardWei;

    @Column(name = "seller_award_wei", length = 78)
    private String sellerAwardWei;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

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

    public String getSellerAddress() {
        return sellerAddress;
    }

    public void setSellerAddress(String sellerAddress) {
        this.sellerAddress = sellerAddress;
    }

    public String getBuyerAddress() {
        return buyerAddress;
    }

    public void setBuyerAddress(String buyerAddress) {
        this.buyerAddress = buyerAddress;
    }

    public String getArbiterAddress() {
        return arbiterAddress;
    }

    public void setArbiterAddress(String arbiterAddress) {
        this.arbiterAddress = arbiterAddress;
    }

    public String getAmountWei() {
        return amountWei;
    }

    public void setAmountWei(String amountWei) {
        this.amountWei = amountWei;
    }

    public String getTermsHash() {
        return termsHash;
    }

    public void setTermsHash(String termsHash) {
        this.termsHash = termsHash;
    }

    public Instant getFundingDeadline() {
        return fundingDeadline;
    }

    public void setFundingDeadline(Instant fundingDeadline) {
        this.fundingDeadline = fundingDeadline;
    }

    public Instant getDeliveryDeadline() {
        return deliveryDeadline;
    }

    public void setDeliveryDeadline(Instant deliveryDeadline) {
        this.deliveryDeadline = deliveryDeadline;
    }

    public long getInspectionWindowSeconds() {
        return inspectionWindowSeconds;
    }

    public void setInspectionWindowSeconds(long inspectionWindowSeconds) {
        this.inspectionWindowSeconds = inspectionWindowSeconds;
    }

    public Instant getDeliveredAt() {
        return deliveredAt;
    }

    public void setDeliveredAt(Instant deliveredAt) {
        this.deliveredAt = deliveredAt;
    }

    public Instant getFundedAt() {
        return fundedAt;
    }

    public void setFundedAt(Instant fundedAt) {
        this.fundedAt = fundedAt;
    }

    public DealStatus getStatus() {
        return status;
    }

    public void setStatus(DealStatus status) {
        this.status = status;
    }

    public boolean isOnChainBound() {
        return onChainBound;
    }

    public void setOnChainBound(boolean onChainBound) {
        this.onChainBound = onChainBound;
    }

    public boolean isSettled() {
        return settled;
    }

    public void setSettled(boolean settled) {
        this.settled = settled;
    }

    public String getCreateTxHash() {
        return createTxHash;
    }

    public void setCreateTxHash(String createTxHash) {
        this.createTxHash = createTxHash;
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

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
