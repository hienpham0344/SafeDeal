#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]
#![deny(unsafe_code)]

use std::net::SocketAddr;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use safedeal_api::assemble_application;
use safedeal_domain::ports::BlockchainGateway;
use safedeal_infrastructure::blockchain::AlloyBlockchainGateway;
use safedeal_infrastructure::config::AppConfig;
use safedeal_infrastructure::persistence::{create_pg_pool, run_migrations};
use tokio::net::TcpListener;
use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    let _ = dotenvy::dotenv();

    let config = match AppConfig::from_env() {
        Ok(cfg) => cfg,
        Err(err) => {
            eprintln!("SafeDeal configuration validation failed: {err}");
            return ExitCode::FAILURE;
        }
    };

    init_tracing(config.is_prod_or_staging());

    if let Err(err) = run_server(config).await {
        tracing::error!(error = %err, "SafeDeal server terminated with error");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

fn init_tracing(use_json: bool) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx::query=warn,tower_http=info"));

    if use_json {
        let _ = tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .with_target(true)
            .try_init();
    } else {
        let _ = tracing_subscriber::fmt()
            .compact()
            .with_env_filter(filter)
            .with_target(true)
            .try_init();
    }
}

async fn run_server(config: AppConfig) -> Result<(), String> {
    let pool = create_pg_pool(&config.database)
        .await
        .map_err(|e| format!("Failed to connect to PostgreSQL: {e}"))?;

    run_migrations(&pool)
        .await
        .map_err(|e| format!("Failed to apply database migrations: {e}"))?;

    let gateway: Arc<dyn BlockchainGateway> =
        Arc::new(AlloyBlockchainGateway::new(&config.blockchain)?);
    let components = assemble_application(&config, pool.clone(), gateway)?;

    let shutdown = CancellationToken::new();
    let indexer_task = if config.blockchain.enabled {
        let indexer = Arc::clone(&components.indexer);
        let cancel = shutdown.clone();
        let interval_ms = config.blockchain.poll_interval_ms.max(200);
        Some(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(interval_ms));
            ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        tracing::info!("Stopping background blockchain event indexer");
                        break;
                    }
                    _ = ticker.tick() => {
                        if let Err(err) = indexer.poll_and_index().await {
                            tracing::warn!(error = %err, "Blockchain event indexer poll failed");
                        }
                    }
                }
            }
        }))
    } else {
        tracing::info!("Background blockchain event indexer disabled by configuration");
        None
    };

    let bind_addr = format!("{}:{}", config.server_host, config.server_port);
    let listener = TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| format!("Failed to bind TCP listener on {bind_addr}: {e}"))?;

    tracing::info!(
        address = %bind_addr,
        chain_id = config.blockchain.chain_id,
        blockchain_sync_enabled = config.blockchain.enabled,
        api_docs_enabled = config.api_docs_enabled,
        swagger_ui_enabled = config.swagger_ui_enabled,
        "SafeDeal Rust API server listening"
    );

    let service = components
        .router
        .into_make_service_with_connect_info::<SocketAddr>();
    let serve_result = axum::serve(listener, service)
        .with_graceful_shutdown(shutdown_signal(shutdown.clone()))
        .await
        .map_err(|e| format!("HTTP server error: {e}"));

    shutdown.cancel();

    if let Some(handle) = indexer_task {
        let _ = tokio::time::timeout(Duration::from_secs(5), handle).await;
    }

    pool.close().await;
    serve_result
}

async fn shutdown_signal(cancel: CancellationToken) {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                let _ = sig.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("Received SIGINT, initiating graceful shutdown"),
        _ = terminate => tracing::info!("Received SIGTERM, initiating graceful shutdown"),
    }

    cancel.cancel();
}
