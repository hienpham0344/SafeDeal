package com.safedeal.infrastructure.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.safedeal.infrastructure.configuration.RateLimitProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class AuthRateLimitFilterTest {

    @Test
    void enforcesPerRemoteAddrLimitAndIgnoresSpoofedXForwardedForHeader() throws Exception {
        RateLimitProperties props = new RateLimitProperties();
        props.setEnabled(true);
        props.setAuthRequestsPerMinute(2);

        AuthRateLimitFilter filter = new AuthRateLimitFilter(props);

        for (int i = 0; i < 2; i++) {
            MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/v1/auth/nonce");
            req.setRemoteAddr("198.51.100.10");
            req.addHeader("X-Forwarded-For", "203.0.113." + (i + 1));
            MockHttpServletResponse res = new MockHttpServletResponse();
            filter.doFilter(req, res, new MockFilterChain());
            assertThat(res.getStatus()).isEqualTo(200);
        }

        MockHttpServletRequest spoofedReq = new MockHttpServletRequest("POST", "/api/v1/auth/verify");
        spoofedReq.setRemoteAddr("198.51.100.10");
        spoofedReq.addHeader("X-Forwarded-For", "203.0.113.99");
        MockHttpServletResponse spoofedRes = new MockHttpServletResponse();
        filter.doFilter(spoofedReq, spoofedRes, new MockFilterChain());

        assertThat(spoofedRes.getStatus()).isEqualTo(429);
        assertThat(spoofedRes.getContentAsString()).contains("RATE_LIMITED");
    }
}
