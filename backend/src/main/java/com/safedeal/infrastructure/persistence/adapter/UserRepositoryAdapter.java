package com.safedeal.infrastructure.persistence.adapter;

import com.safedeal.domain.authentication.UserAccount;
import com.safedeal.domain.port.UserRepository;
import com.safedeal.infrastructure.persistence.entity.JpaUserEntity;
import com.safedeal.infrastructure.persistence.jpa.SpringDataUserRepository;
import java.time.Instant;
import java.util.Optional;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepositoryAdapter implements UserRepository {

    private final SpringDataUserRepository jpa;

    public UserRepositoryAdapter(SpringDataUserRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public UserAccount upsertLogin(String walletAddress, Instant loginAt) {
        String normalized = walletAddress.toLowerCase();
        JpaUserEntity entity = jpa.findByWalletAddressIgnoreCase(normalized).orElseGet(() -> {
            JpaUserEntity created = new JpaUserEntity();
            created.setWalletAddress(normalized);
            created.setCreatedAt(loginAt);
            return created;
        });
        entity.setLastLoginAt(loginAt);
        JpaUserEntity saved = jpa.save(entity);
        return toDomain(saved);
    }

    @Override
    public Optional<UserAccount> findByWalletAddress(String walletAddress) {
        return jpa.findByWalletAddressIgnoreCase(walletAddress).map(this::toDomain);
    }

    private UserAccount toDomain(JpaUserEntity e) {
        return new UserAccount(e.getId(), e.getWalletAddress(), e.getCreatedAt(), e.getLastLoginAt());
    }
}
