package com.safedeal.presentation.rest;

import com.safedeal.application.dispute.DisputeUseCase;
import com.safedeal.domain.authentication.AuthenticatedPrincipal;
import com.safedeal.presentation.dto.DisputeDtos;
import com.safedeal.presentation.mapper.ApiDtoMapper;
import com.safedeal.shared.exception.UnauthorizedException;
import com.safedeal.shared.exception.ValidationException;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.List;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1")
public class DisputeController {

    private final DisputeUseCase disputeUseCase;

    public DisputeController(DisputeUseCase disputeUseCase) {
        this.disputeUseCase = disputeUseCase;
    }

    @PostMapping("/deals/{tradeId}/disputes")
    @ResponseStatus(HttpStatus.CREATED)
    public DisputeDtos.DisputeDetailResponse openDispute(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @PathVariable String tradeId,
        @Valid @RequestBody DisputeDtos.OpenDisputeRequest request
    ) {
        String caller = requireAddress(principal);
        var created = disputeUseCase.openDispute(
            tradeId,
            caller,
            request.reason(),
            request.summary(),
            request.txHash()
        );
        return ApiDtoMapper.toDisputeDetail(created);
    }

    @GetMapping("/disputes/{disputeId}")
    public DisputeDtos.DisputeDetailResponse getDispute(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @PathVariable Long disputeId
    ) {
        String caller = requireAddress(principal);
        return ApiDtoMapper.toDisputeDetail(disputeUseCase.getDispute(disputeId, caller));
    }

    @GetMapping("/disputes/{disputeId}/evidence")
    public List<DisputeDtos.DisputeEvidenceResponse> listEvidence(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @PathVariable Long disputeId
    ) {
        String caller = requireAddress(principal);
        return disputeUseCase.listEvidence(disputeId, caller).stream()
            .map(ApiDtoMapper::toEvidenceResponse)
            .toList();
    }

    @PostMapping(value = "/disputes/{disputeId}/evidence", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public DisputeDtos.DisputeEvidenceResponse uploadEvidence(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @PathVariable Long disputeId,
        @RequestParam("title") String title,
        @RequestParam("notes") String notes,
        @RequestParam(value = "file", required = false) MultipartFile file
    ) throws IOException {
        String caller = requireAddress(principal);
        if (file != null && file.isEmpty()) {
            throw new ValidationException("Attached evidence file cannot be empty.");
        }
        byte[] bytes = file != null ? file.getBytes() : null;
        String originalName = file != null ? file.getOriginalFilename() : null;
        String contentType = file != null ? file.getContentType() : null;

        var saved = disputeUseCase.uploadEvidence(
            disputeId,
            caller,
            title,
            notes,
            originalName,
            contentType,
            bytes
        );
        return ApiDtoMapper.toEvidenceResponse(saved);
    }

    @GetMapping("/disputes/{disputeId}/evidence/{evidenceId}/download")
    public ResponseEntity<Resource> downloadEvidence(
        @AuthenticationPrincipal AuthenticatedPrincipal principal,
        @PathVariable Long disputeId,
        @PathVariable Long evidenceId
    ) {
        String caller = requireAddress(principal);
        var download = disputeUseCase.downloadEvidence(disputeId, evidenceId, caller);
        String filename = download.metadata().fileName() != null ? download.metadata().fileName() : "evidence.bin";
        MediaType mediaType = download.metadata().mimeType() != null
            ? MediaType.parseMediaType(download.metadata().mimeType())
            : MediaType.APPLICATION_OCTET_STREAM;

        HttpHeaders headers = new HttpHeaders();
        headers.setContentDisposition(ContentDisposition.attachment().filename(filename).build());
        headers.setCacheControl("no-store");
        headers.set("X-Content-Type-Options", "nosniff");

        return ResponseEntity.ok()
            .headers(headers)
            .contentType(mediaType)
            .contentLength(download.bytes().length)
            .body(new ByteArrayResource(download.bytes()));
    }

    private String requireAddress(AuthenticatedPrincipal principal) {
        if (principal == null) {
            throw new UnauthorizedException("Wallet authentication required.");
        }
        return principal.address();
    }
}
