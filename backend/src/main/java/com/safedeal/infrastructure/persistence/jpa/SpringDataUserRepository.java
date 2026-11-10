package com.safedeal.infrastructure.persistence.jpa;

import com.safedeal.infrastructure.persistence.entity.JpaUserEntity;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SpringDataUserRepository extends JpaRepository<JpaUserEntity, Long> {
    Optional<JpaUserEntity> findByWalletAddressIgnoreCase(String walletAddress);
}
