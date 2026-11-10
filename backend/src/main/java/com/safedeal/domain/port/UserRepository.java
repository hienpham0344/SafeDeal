package com.safedeal.domain.port;

import com.safedeal.domain.authentication.UserAccount;
import java.time.Instant;
import java.util.Optional;

public interface UserRepository {
    UserAccount upsertLogin(String walletAddress, Instant loginAt);

    Optional<UserAccount> findByWalletAddress(String walletAddress);
}
