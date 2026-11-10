package com.safedeal.presentation.rest;

import com.safedeal.application.authentication.SessionCookiePort;
import com.safedeal.application.authentication.SiweAuthService;
import com.safedeal.domain.authentication.AuthenticatedPrincipal;
import com.safedeal.presentation.dto.AuthDtos;
import com.safedeal.shared.exception.UnauthorizedException;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final SiweAuthService authService;
    private final SessionCookiePort cookiePort;

    public AuthController(SiweAuthService authService, SessionCookiePort cookiePort) {
        this.authService = authService;
        this.cookiePort = cookiePort;
    }

    @PostMapping("/nonce")
    public AuthDtos.NonceResponse issueNonce(@Valid @RequestBody AuthDtos.NonceRequest request) {
        var challenge = authService.issueChallenge(request.address(), request.chainId());
        return new AuthDtos.NonceResponse(
            challenge.nonce(),
            challenge.domain(),
            challenge.uri(),
            challenge.chainId(),
            challenge.issuedAt(),
            challenge.expirationTime(),
            challenge.statement(),
            challenge.message()
        );
    }

    @PostMapping("/verify")
    public AuthDtos.SessionUserResponse verify(
        @Valid @RequestBody AuthDtos.VerifyRequest request,
        HttpServletResponse response
    ) {
        AuthenticatedPrincipal principal = authService.verifyAndAuthenticate(request.message(), request.signature());
        cookiePort.writeSessionCookies(response, principal);
        return new AuthDtos.SessionUserResponse(
            principal.address(),
            principal.chainId(),
            principal.authenticatedAt(),
            principal.csrfToken()
        );
    }

    @GetMapping("/me")
    public AuthDtos.SessionUserResponse currentSession(@AuthenticationPrincipal AuthenticatedPrincipal principal) {
        if (principal == null) {
            throw new UnauthorizedException("Wallet session is not authenticated.");
        }
        return new AuthDtos.SessionUserResponse(
            principal.address(),
            principal.chainId(),
            principal.authenticatedAt(),
            principal.csrfToken()
        );
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletResponse response) {
        cookiePort.clearSessionCookies(response);
    }
}
