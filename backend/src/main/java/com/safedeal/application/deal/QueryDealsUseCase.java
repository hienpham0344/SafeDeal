package com.safedeal.application.deal;

import com.safedeal.domain.deal.BlockchainTransaction;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealEvent;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.dispute.Dispute;
import com.safedeal.domain.port.BlockchainTransactionRepository;
import com.safedeal.domain.port.DealEventRepository;
import com.safedeal.domain.port.DealRepository;
import com.safedeal.domain.port.DisputeRepository;
import com.safedeal.shared.exception.ForbiddenException;
import com.safedeal.shared.exception.NotFoundException;
import com.safedeal.shared.exception.ValidationException;
import com.safedeal.shared.validation.EthFormatValidator;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class QueryDealsUseCase {

    public record DealWithDispute(Deal deal, Long disputeId) {
    }

    public record DealHistory(List<DealEvent> events, List<BlockchainTransaction> transactions) {
    }

    private final DealRepository dealRepository;
    private final DealEventRepository dealEventRepository;
    private final BlockchainTransactionRepository txRepository;
    private final DisputeRepository disputeRepository;

    public QueryDealsUseCase(
        DealRepository dealRepository,
        DealEventRepository dealEventRepository,
        BlockchainTransactionRepository txRepository,
        DisputeRepository disputeRepository
    ) {
        this.dealRepository = dealRepository;
        this.dealEventRepository = dealEventRepository;
        this.txRepository = txRepository;
        this.disputeRepository = disputeRepository;
    }

    public DealRepository.PageSlice listUserDeals(
        String walletAddress,
        String role,
        String statusParam,
        int page,
        int size
    ) {
        String caller = EthFormatValidator.requireAddress(walletAddress, "walletAddress");
        int boundedPage = Math.max(0, page);
        int boundedSize = Math.min(Math.max(1, size), 100);
        DealStatus statusFilter = null;
        if (statusParam != null && !statusParam.isBlank() && !"ALL".equalsIgnoreCase(statusParam)) {
            try {
                statusFilter = DealStatus.valueOf(statusParam.trim().toUpperCase());
            } catch (IllegalArgumentException ex) {
                throw new ValidationException("Unsupported status filter: " + statusParam);
            }
        }
        return dealRepository.findUserDeals(caller, role, statusFilter, boundedPage, boundedSize);
    }

    public DealWithDispute getDeal(String rawTradeId, String walletAddress) {
        String tradeId = EthFormatValidator.requireBytes32(rawTradeId, "tradeId");
        String caller = EthFormatValidator.requireAddress(walletAddress, "walletAddress");
        Deal deal = dealRepository.findByTradeId(tradeId)
            .orElseThrow(() -> new NotFoundException("Deal not found: " + tradeId));
        if (!deal.canView(caller)) {
            throw new ForbiddenException("Access denied for deal " + tradeId);
        }
        Long disputeId = disputeRepository.findByTradeId(tradeId).map(Dispute::id).orElse(null);
        return new DealWithDispute(deal, disputeId);
    }

    public Optional<Long> findDisputeId(String tradeId) {
        return disputeRepository.findByTradeId(tradeId).map(Dispute::id);
    }

    public java.util.Map<String, Long> findDisputeIds(java.util.Collection<String> tradeIds) {
        return disputeRepository.findDisputeIdsByTradeIds(tradeIds);
    }

    public DealHistory getHistory(String rawTradeId, String walletAddress) {
        String tradeId = EthFormatValidator.requireBytes32(rawTradeId, "tradeId");
        String caller = EthFormatValidator.requireAddress(walletAddress, "walletAddress");
        Deal deal = dealRepository.findByTradeId(tradeId)
            .orElseThrow(() -> new NotFoundException("Deal not found: " + tradeId));
        if (!deal.canView(caller)) {
            throw new ForbiddenException("Access denied for deal history " + tradeId);
        }
        List<DealEvent> events = dealEventRepository.findByTradeIdOrderByCreatedAtAsc(tradeId);
        List<BlockchainTransaction> txs = txRepository.findByTradeIdOrderByCreatedAtAsc(tradeId);
        return new DealHistory(events, txs);
    }
}
