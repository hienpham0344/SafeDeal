package com.safedeal.presentation.rest;

import com.safedeal.application.deal.BindDealTransactionUseCase;
import com.safedeal.application.deal.CreateDealDraftUseCase;
import com.safedeal.application.deal.QueryDealsUseCase;
import com.safedeal.application.deal.SyncDealUseCase;
import com.safedeal.domain.authentication.AuthenticatedPrincipal;
import com.safedeal.domain.deal.Deal;
import com.safedeal.domain.port.DealRepository;
import com.safedeal.presentation.dto.DealDtos;
import com.safedeal.presentation.mapper.ApiDtoMapper;
import com.safedeal.shared.exception.UnauthorizedException;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/deals")
public class DealController {

    private final CreateDealDraftUseCase createDealDraftUseCase;
    private final BindDealTransactionUseCase bindDealTransactionUseCase;
    private final SyncDealUseCase syncDealUseCase;
    private final QueryDealsUseCase queryDealsUseCase;

    public DealController(
        CreateDealDraftUseCase createDealDraftUseCase,
        BindDealTransactionUseCase bindDealTransactionUseCase,
        SyncDealUseCase syncDealUseCase,
        QueryDealsUseCase queryDealsUseCase
    ) {
        this.createDealDraftUseCase = createDealDraftUseCase;
        this.bindDealTransactionUseCase = bindDealTransactionUseCase;
        this.syncDealUseCase = syncDealUseCase;
        this.queryDealsUseCase = queryDealsUseCase;
    }

    @PostMapping("/drafts")
    @ResponseStatus(HttpStatus.CREATED)
    public DealDtos.CreateDraftResponse createDraft(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @Valid @RequestBody DealDtos.CreateDraftRequest request
    ) {
        String caller = requireAddress(principal);
        Deal created = createDealDraftUseCase.execute(new CreateDealDraftUseCase.Command(
            caller,
            request.buyerAddress(),
            request.arbiterAddress(),
            request.amountWei(),
            request.fundingDeadlineEpochSeconds(),
            request.deliveryDeadlineEpochSeconds(),
            request.inspectionWindowSeconds(),
            request.title(),
            request.description(),
            request.terms()
        ));
        DealDtos.DealDetailResponse detail = ApiDtoMapper.toDetail(created, null);
        return new DealDtos.CreateDraftResponse(
            detail,
            created.tradeId(),
            created.termsHash(),
            created.canonicalTermsJson(),
            created.chainId(),
            created.contractAddress()
        );
    }

    @PostMapping("/{tradeId}/bind-tx")
    public DealDtos.DealDetailResponse bindTransaction(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @PathVariable String tradeId,
        @Valid @RequestBody DealDtos.BindTxRequest request
    ) {
        String caller = requireAddress(principal);
        Deal updated = bindDealTransactionUseCase.execute(tradeId, request.txHash(), caller);
        Long disputeId = queryDealsUseCase.findDisputeId(updated.tradeId()).orElse(null);
        return ApiDtoMapper.toDetail(updated, disputeId);
    }

    @PostMapping("/{tradeId}/sync")
    public DealDtos.DealDetailResponse syncDeal(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @PathVariable String tradeId,
        @RequestBody(required = false) DealDtos.SyncRequest request
    ) {
        String caller = requireAddress(principal);
        Deal updated = syncDealUseCase.execute(tradeId, request != null ? request.txHash() : null, caller);
        Long disputeId = queryDealsUseCase.findDisputeId(updated.tradeId()).orElse(null);
        return ApiDtoMapper.toDetail(updated, disputeId);
    }

    @GetMapping
    public DealDtos.PaginatedResponse<DealDtos.DealSummaryResponse> listDeals(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @RequestParam(required = false, defaultValue = "all") String role,
        @RequestParam(required = false) String status,
        @RequestParam(required = false, defaultValue = "0") int page,
        @RequestParam(required = false, defaultValue = "20") int size
    ) {
        String caller = requireAddress(principal);
        DealRepository.PageSlice slice = queryDealsUseCase.listUserDeals(caller, role, status, page, size);
        java.util.Map<String, Long> disputeIds = queryDealsUseCase.findDisputeIds(
            slice.items().stream().map(Deal::tradeId).toList()
        );
        List<DealDtos.DealSummaryResponse> items = slice.items().stream()
            .map(d -> ApiDtoMapper.toSummary(d, disputeIds.get(d.tradeId().toLowerCase())))
            .toList();
        return new DealDtos.PaginatedResponse<>(
            items,
            slice.page(),
            slice.size(),
            slice.totalItems(),
            slice.totalPages()
        );
    }

    @GetMapping("/{tradeId}")
    public DealDtos.DealDetailResponse getDeal(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @PathVariable String tradeId
    ) {
        String caller = requireAddress(principal);
        var result = queryDealsUseCase.getDeal(tradeId, caller);
        return ApiDtoMapper.toDetail(result.deal(), result.disputeId());
    }

    @GetMapping("/{tradeId}/history")
    public DealDtos.DealHistoryResponse getHistory(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @PathVariable String tradeId
    ) {
        String caller = requireAddress(principal);
        var history = queryDealsUseCase.getHistory(tradeId, caller);
        return new DealDtos.DealHistoryResponse(
            history.events().stream().map(ApiDtoMapper::toEventResponse).toList(),
            history.transactions().stream().map(ApiDtoMapper::toTxResponse).toList()
        );
    }

    private String requireAddress(AuthenticatedPrincipal principal) {
        if (principal == null) {
            throw new UnauthorizedException("Wallet authentication required.");
        }
        return principal.address();
    }
}
