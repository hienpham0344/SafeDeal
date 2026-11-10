package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.authentication.AuthNonce;
import com.safedeal.domain.port.AuthNonceRepository;
import com.safedeal.infrastructure.persistence.entity.JpaAuthNonceEntity;
import com.safedeal.infrastructure.persistence.jpa.SpringDataAuthNonceRepository;
import java.time.Instant;
import java.util.Optional;
import org.springframework.stereotype.Repository;

@Repository
public class AuthNonceRepositoryAdapter implements AuthNonceRepository {

    private final SpringDataAuthNonceRepository jpa;

    public AuthNonceRepositoryAdapter(SpringDataAuthNonceRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public AuthNonce save(AuthNonce nonce) {
        JpaAuthNonceEntity entity = new JpaAuthNonceEntity();
        entity.setId(nonce.id());
        entity.setNonce(nonce.nonce());
        entity.setWalletAddress(nonce.walletAddress().toLowerCase());
        entity.setChainId(nonce.chainId());
        entity.setSiweMessage(nonce.siweMessage());
        entity.setIssuedAt(nonce.issuedAt());
        entity.setExpiresAt(nonce.expiresAt());
        entity.setConsumedAt(nonce.consumedAt());
        return toDomain(jpa.save(entity));
    }

    @Override
    public Optional<AuthNonce> findByNonce(String nonce) {
        return jpa.findByNonce(nonce).map(this::toDomain);
    }

    @Override
    public boolean consumeOnce(String nonce, String walletAddress, long chainId, Instant now) {
        return jpa.consumeOnce(nonce, walletAddress, chainId, now) == 1;
    }

    private AuthNonce toDomain(JpaAuthNonceEntity e) {
        return new AuthNonce(
            e.getId(),
            e.getNonce(),
            e.getWalletAddress(),
            e.getChainId(),
            e.getSiweMessage(),
            e.getIssuedAt(),
            e.getExpiresAt(),
            e.getConsumedAt()
        );
    }
}
