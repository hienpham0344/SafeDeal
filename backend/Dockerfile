# syntax=docker/dockerfile:1

FROM lukemathwalker/cargo-chef:latest-rust-1-bookworm AS chef
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY src ./src
COPY migrations ./migrations
COPY tests ./tests
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
RUN apt-get update && apt-get install -y --no-install-recommends cmake && rm -rf /var/lib/apt/lists/*
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --bin safedeal-api --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked --bin safedeal-api

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && groupadd --system safedeal && useradd --system --gid safedeal --home /app safedeal \
    && mkdir -p /app/storage/evidence && chown -R safedeal:safedeal /app

COPY --from=builder --chown=safedeal:safedeal /app/target/release/safedeal-api /app/safedeal-api
COPY --from=builder --chown=safedeal:safedeal /app/migrations /app/migrations

USER safedeal
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c 'curl -fsS "http://127.0.0.1:${SERVER_PORT:-${PORT:-8080}}/api/v1/health" || exit 1'

ENTRYPOINT ["/app/safedeal-api"]
