package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.deal.DealStatus;
import com.safedeal.domain.port.DealRepository;
import com.safedeal.infrastructure.persistence.entity.JpaDealEntity;
import com.safedeal.infrastructure.persistence.entity.JpaDealTermsEntity;
import com.safedeal.infrastructure.persistence.jpa.SpringDataDealRepository;
import com.safedeal.infrastructure.persistence.jpa.SpringDataDealTermsRepository;
import jakarta.persistence.criteria.Predicate;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Repository;

@Repository
public class DealRepositoryAdapter implements DealRepository {

    private final SpringDataDealRepository dealJpa;
    private final SpringDataDealTermsRepository termsJpa;

    public DealRepositoryAdapter(SpringDataDealRepository dealJpa, SpringDataDealTermsRepository termsJpa) {
        this.dealJpa = dealJpa;
        this.termsJpa = termsJpa;
    }

    @Override
    public Deal save(Deal deal) {
        JpaDealEntity entity = deal.id() != null
            ? dealJpa.findById(deal.id()).orElseGet(JpaDealEntity::new)
            : new JpaDealEntity();
        entity.setTradeId(deal.tradeId().toLowerCase(Locale.ROOT));
        entity.setChainId(deal.chainId());
        entity.setContractAddress(deal.contractAddress().toLowerCase(Locale.ROOT));
        entity.setSellerAddress(deal.seller().toLowerCase(Locale.ROOT));
        entity.setBuyerAddress(deal.buyer() != null ? deal.buyer().toLowerCase(Locale.ROOT) : null);
        entity.setArbiterAddress(deal.arbiter().toLowerCase(Locale.ROOT));
        entity.setAmountWei(deal.amountWei());
        entity.setTermsHash(deal.termsHash().toLowerCase(Locale.ROOT));
        entity.setFundingDeadline(deal.fundingDeadline());
        entity.setDeliveryDeadline(deal.deliveryDeadline());
        entity.setInspectionWindowSeconds(deal.inspectionWindowSeconds());
        entity.setDeliveredAt(deal.deliveredAt());
        entity.setFundedAt(deal.fundedAt());
        entity.setStatus(deal.status());
        entity.setOnChainBound(deal.onChainBound());
        entity.setSettled(deal.settled());
        entity.setCreateTxHash(deal.createTxHash() != null ? deal.createTxHash().toLowerCase(Locale.ROOT) : null);
        entity.setBuyerAwardWei(deal.buyerAwardWei());
        entity.setSellerAwardWei(deal.sellerAwardWei());
        entity.setCreatedAt(deal.createdAt());
        entity.setUpdatedAt(deal.updatedAt());

        JpaDealEntity savedDeal = dealJpa.save(entity);
        JpaDealTermsEntity termsEntity = termsJpa.findByDealId(savedDeal.getId()).orElseGet(() -> {
            JpaDealTermsEntity created = new JpaDealTermsEntity();
            created.setDealId(savedDeal.getId());
            created.setCreatedAt(deal.createdAt());
            return created;
        });
        termsEntity.setTitle(deal.title());
        termsEntity.setDescription(deal.description());
        termsEntity.setTermsText(deal.terms());
        termsEntity.setCanonicalJson(deal.canonicalTermsJson());
        termsEntity.setTermsHash(deal.termsHash().toLowerCase(Locale.ROOT));
        termsEntity.setSchemaVersion(deal.schemaVersion());
        JpaDealTermsEntity savedTerms = termsJpa.save(termsEntity);
        return toDomain(savedDeal, savedTerms);
    }

    @Override
    public Optional<Deal> findByTradeId(String tradeId) {
        return dealJpa.findByTradeIdIgnoreCase(tradeId)
            .map(e -> toDomain(e, termsJpa.findByDealId(e.getId()).orElse(null)));
    }

    @Override
    public Optional<Deal> findByTradeIdForUpdate(String tradeId) {
        String normalized = tradeId == null ? "" : tradeId.trim().toLowerCase(Locale.ROOT);
        return dealJpa.findByTradeIdForUpdate(normalized)
            .map(e -> toDomain(e, termsJpa.findByDealId(e.getId()).orElse(null)));
    }

    @Override
    public Optional<Deal> findByCreateTxHash(String createTxHash) {
        if (createTxHash == null || createTxHash.isBlank()) {
            return Optional.empty();
        }
        return dealJpa.findByCreateTxHashIgnoreCase(createTxHash.trim())
            .map(e -> toDomain(e, termsJpa.findByDealId(e.getId()).orElse(null)));
    }

    @Override
    public boolean existsByCreateTxHash(String createTxHash) {
        return dealJpa.existsByCreateTxHashIgnoreCase(createTxHash);
    }

    @Override
    public PageSlice findUserDeals(String walletAddress, String role, DealStatus statusFilter, int page, int size) {
        String lower = walletAddress.toLowerCase();
        Specification<JpaDealEntity> spec = (root, query, cb) -> {
            String normalizedRole = role == null ? "all" : role.trim().toLowerCase();
            Predicate rolePredicate = switch (normalizedRole) {
                case "seller", "created" -> cb.equal(cb.lower(root.get("sellerAddress")), lower);
                case "buyer" -> cb.equal(cb.lower(root.get("buyerAddress")), lower);
                case "funded" -> cb.and(
                    cb.equal(cb.lower(root.get("buyerAddress")), lower),
                    root.get("status").in(List.of(DealStatus.DRAFT, DealStatus.CREATED)).not()
                );
                case "arbiter" -> cb.equal(cb.lower(root.get("arbiterAddress")), lower);
                default -> cb.or(
                    cb.equal(cb.lower(root.get("sellerAddress")), lower),
                    cb.equal(cb.lower(root.get("buyerAddress")), lower),
                    cb.equal(cb.lower(root.get("arbiterAddress")), lower)
                );
            };
            if (statusFilter != null) {
                return cb.and(rolePredicate, cb.equal(root.get("status"), statusFilter));
            }
            return rolePredicate;
        };

        Page<JpaDealEntity> result = dealJpa.findAll(
            spec,
            PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt", "id"))
        );

        List<Long> ids = result.getContent().stream().map(JpaDealEntity::getId).toList();
        Map<Long, JpaDealTermsEntity> termsByDealId = ids.isEmpty()
            ? Map.of()
            : termsJpa.findByDealIdIn(ids).stream()
                .collect(Collectors.toMap(JpaDealTermsEntity::getDealId, Function.identity()));

        List<Deal> deals = result.getContent().stream()
            .map(e -> toDomain(e, termsByDealId.get(e.getId())))
            .toList();

        return new PageSlice(deals, result.getNumber(), result.getSize(), result.getTotalElements(), result.getTotalPages());
    }

    @Override
    public List<Deal> findOpenBoundDeals() {
        List<JpaDealEntity> entities = dealJpa.findByOnChainBoundTrueAndSettledFalse();
        List<Long> ids = entities.stream().map(JpaDealEntity::getId).toList();
        Map<Long, JpaDealTermsEntity> termsByDealId = ids.isEmpty()
            ? Map.of()
            : termsJpa.findByDealIdIn(ids).stream()
                .collect(Collectors.toMap(JpaDealTermsEntity::getDealId, Function.identity()));
        return entities.stream().map(e -> toDomain(e, termsByDealId.get(e.getId()))).toList();
    }

    private Deal toDomain(JpaDealEntity e, JpaDealTermsEntity t) {
        return new Deal(
            e.getId(),
            e.getTradeId(),
            e.getChainId(),
            e.getContractAddress(),
            e.getSellerAddress(),
            e.getBuyerAddress(),
            e.getArbiterAddress(),
            e.getAmountWei(),
            e.getTermsHash(),
            e.getFundingDeadline(),
            e.getDeliveryDeadline(),
            e.getInspectionWindowSeconds(),
            e.getDeliveredAt(),
            e.getFundedAt(),
            e.getStatus(),
            e.isOnChainBound(),
            e.isSettled(),
            e.getCreateTxHash(),
            e.getBuyerAwardWei(),
            e.getSellerAwardWei(),
            t != null ? t.getTitle() : "",
            t != null ? t.getDescription() : "",
            t != null ? t.getTermsText() : "",
            t != null ? t.getCanonicalJson() : "{}",
            t != null ? t.getSchemaVersion() : 1,
            e.getCreatedAt(),
            e.getUpdatedAt()
        );
    }
}
