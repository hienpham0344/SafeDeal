package com.safedeal.infrastructure.persistence.jpa;

import com.safedeal.infrastructure.persistence.entity.JpaAuthNonceEntity;
import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpringDataAuthNonceRepository extends JpaRepository<JpaAuthNonceEntity, Long> {
    Optional<JpaAuthNonceEntity> findByNonce(String nonce);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
        UPDATE JpaAuthNonceEntity n
        SET n.consumedAt = :now
        WHERE n.nonce = :nonce
          AND LOWER(n.walletAddress) = LOWER(:walletAddress)
          AND n.chainId = :chainId
          AND n.consumedAt IS NULL
          AND n.expiresAt > :now
        """)
    int consumeOnce(
        @Param("nonce") String nonce,
        @Param("walletAddress") String walletAddress,
        @Param("chainId") long chainId,
        @Param("now") Instant now
    );
}
