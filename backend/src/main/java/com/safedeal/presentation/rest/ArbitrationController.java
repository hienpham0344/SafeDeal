package com.safedeal.presentation.rest;

import com.safedeal.application.arbitration.ArbitrationUseCase;
import com.safedeal.domain.authentication.AuthenticatedPrincipal;
import com.safedeal.presentation.dto.DisputeDtos;
import com.safedeal.presentation.mapper.ApiDtoMapper;
import com.safedeal.shared.exception.UnauthorizedException;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/arbitration")
public class ArbitrationController {

    private final ArbitrationUseCase arbitrationUseCase;

    public ArbitrationController(ArbitrationUseCase arbitrationUseCase) {
        this.arbitrationUseCase = arbitrationUseCase;
    }

    @GetMapping("/disputes")
    public List<DisputeDtos.DisputeDetailResponse> listAssignedDisputes(
        @AuthenticationPrincipal AuthenticatedPrincipal principal
    ) {
        String arbiter = requireAddress(principal);
        return arbitrationUseCase.listAssignedDisputes(arbiter).stream()
            .map(ApiDtoMapper::toDisputeDetail)
            .toList();
    }

    @PostMapping("/disputes/{disputeId}/resolution")
    public DisputeDtos.DisputeDetailResponse recordResolution(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @PathVariable Long disputeId,
        @Valid @RequestBody DisputeDtos.ResolveDisputeRequest request
    ) {
        String arbiter = requireAddress(principal);
        var updated = arbitrationUseCase.recordResolution(disputeId, arbiter, request.txHash(), request.rationale());
        return ApiDtoMapper.toDisputeDetail(updated);
    }

    private String requireAddress(AuthenticatedPrincipal principal) {
        if (principal == null) {
            throw new UnauthorizedException("Wallet authentication required.");
        }
        return principal.address();
    }
}
