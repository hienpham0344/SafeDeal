package com.safedeal.application.authentication;

public record SiweSettings(
    String siweDomain,
    String siweUri,
    long chainId,
    long nonceTtlSeconds,
    String statement
) {
}
