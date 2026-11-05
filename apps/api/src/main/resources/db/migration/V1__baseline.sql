-- Baseline migration. Business tables arrive with later, module-specific migrations
-- (V2__..., V3__...). chain_transactions lives here because the blockchain module's
-- verification service is part of the initial foundation.
-- Keep every Vn__ name unique; Flyway fails if two modules reuse a version number.

CREATE TABLE chain_transactions (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    network       VARCHAR(32)  NOT NULL,
    tx_hash       VARCHAR(66)  NOT NULL,
    status        VARCHAR(16)  NOT NULL,
    block_number  BIGINT,
    submitted_at  TIMESTAMP    NOT NULL,
    confirmed_at  TIMESTAMP,
    CONSTRAINT uq_chain_transactions_network_hash UNIQUE (network, tx_hash),
    CONSTRAINT ck_chain_transactions_status CHECK (status IN ('SUBMITTED', 'PENDING', 'CONFIRMED', 'FAILED'))
);
