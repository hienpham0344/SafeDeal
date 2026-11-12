#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]
#![deny(unsafe_code)]

use std::sync::Arc;

use axum::Router;
use safedeal_application::arbitration::ArbitrationUseCase;
use safedeal_application::auth::{SiweAuthService, SiweSettings};
use safedeal_application::deals::{
    BindDealTransactionUseCase, CreateDealDraftUseCase, QueryDealsUseCase, SyncDealUseCase,
};
use safedeal_application::disputes::DisputeUseCase;
use safedeal_application::indexer::BlockchainEventIndexerService;
use safedeal_domain::ports::BlockchainGateway;
use safedeal_infrastructure::config::AppConfig;
use safedeal_infrastructure::persistence::PgRepositories;
use safedeal_infrastructure::security::{
    apply_security_layers, AuthRateLimitState, HttpSessionCookieAdapter, JwtSessionService,
    K256SignatureVerifier,
};
use safedeal_infrastructure::storage::LocalEvidenceStorageAdapter;
use safedeal_presentation::{build_api_router, AppState};
use sqlx::PgPool;

pub struct ApplicationComponents {
    pub router: Router,
    pub create_deal_draft: Arc<CreateDealDraftUseCase>,
    pub bind_deal_transaction: Arc<BindDealTransactionUseCase>,
    pub sync_deal: Arc<SyncDealUseCase>,
    pub query_deals: Arc<QueryDealsUseCase>,
    pub siwe_auth: Arc<SiweAuthService>,
    pub dispute_use_case: Arc<DisputeUseCase>,
    pub arbitration_use_case: Arc<ArbitrationUseCase>,
    pub indexer: Arc<BlockchainEventIndexerService>,
    pub repos: Arc<PgRepositories>,
    pub evidence_storage: Arc<LocalEvidenceStorageAdapter>,
}

pub fn assemble_application(
    config: &AppConfig,
    pool: PgPool,
    blockchain_gateway: Arc<dyn BlockchainGateway>,
) -> Result<ApplicationComponents, String> {
    let repos = Arc::new(PgRepositories::new(pool));
    let evidence_storage = Arc::new(
        LocalEvidenceStorageAdapter::new(&config.evidence)
            .map_err(|e| format!("Cannot initialize evidence storage: {e}"))?,
    );

    let signature_verifier = Arc::new(K256SignatureVerifier);
    let jwt_service = JwtSessionService::new(&config.auth);
    let session_cookies = Arc::new(HttpSessionCookieAdapter::new(
        jwt_service.clone(),
        &config.auth,
    ));
    let siwe_settings: SiweSettings = config.siwe_settings();

    let siwe_auth = Arc::new(SiweAuthService::new(
        Arc::clone(&repos.uow),
        signature_verifier,
        siwe_settings.clone(),
    ));
    let create_deal_draft = Arc::new(CreateDealDraftUseCase::new(
        Arc::clone(&repos.uow),
        Arc::clone(&blockchain_gateway),
    ));
    let bind_deal_transaction = Arc::new(BindDealTransactionUseCase::new(
        Arc::clone(&repos.uow),
        Arc::clone(&blockchain_gateway),
    ));
    let sync_deal = Arc::new(SyncDealUseCase::new(
        Arc::clone(&repos.uow),
        Arc::clone(&blockchain_gateway),
    ));
    let query_deals = Arc::new(QueryDealsUseCase::new(
        Arc::clone(&repos.deals) as Arc<dyn safedeal_domain::ports::DealRepository>,
        Arc::clone(&repos.deal_events) as Arc<dyn safedeal_domain::ports::DealEventRepository>,
        Arc::clone(&repos.blockchain_transactions)
            as Arc<dyn safedeal_domain::ports::BlockchainTransactionRepository>,
        Arc::clone(&repos.disputes) as Arc<dyn safedeal_domain::ports::DisputeRepository>,
    ));
    let dispute_use_case = Arc::new(DisputeUseCase::new(
        Arc::clone(&repos.uow),
        Arc::clone(&repos.dispute_evidence)
            as Arc<dyn safedeal_domain::ports::DisputeEvidenceRepository>,
        Arc::clone(&repos.audit_logs) as Arc<dyn safedeal_domain::ports::AuditLogRepository>,
        Arc::clone(&blockchain_gateway),
        Arc::clone(&sync_deal),
        Arc::clone(&evidence_storage) as Arc<dyn safedeal_domain::ports::EvidenceStoragePort>,
    ));
    let arbitration_use_case = Arc::new(ArbitrationUseCase::new(
        Arc::clone(&repos.uow),
        Arc::clone(&blockchain_gateway),
    ));
    let indexer = Arc::new(BlockchainEventIndexerService::new(
        Arc::clone(&repos.uow),
        Arc::clone(&blockchain_gateway),
    ));

    let app_state = AppState {
        create_deal_draft: Arc::clone(&create_deal_draft),
        bind_deal_transaction: Arc::clone(&bind_deal_transaction),
        sync_deal: Arc::clone(&sync_deal),
        query_deals: Arc::clone(&query_deals),
        siwe_auth: Arc::clone(&siwe_auth),
        session_cookies,
        dispute_use_case: Arc::clone(&dispute_use_case),
        arbitration_use_case: Arc::clone(&arbitration_use_case),
        blockchain_gateway,
        database_readiness: Arc::clone(&repos.readiness)
            as Arc<dyn safedeal_domain::ports::DatabaseReadinessPort>,
        evidence_storage: Arc::clone(&evidence_storage)
            as Arc<dyn safedeal_domain::ports::EvidenceStoragePort>,
        siwe_settings,
        evidence_max_bytes: config.evidence.max_bytes,
        evidence_max_request_bytes: config.evidence.max_request_bytes,
        api_docs_enabled: config.api_docs_enabled,
        swagger_ui_enabled: config.swagger_ui_enabled,
    };

    let api_router = build_api_router(app_state);
    let rate_limiter = Arc::new(AuthRateLimitState::new(&config.rate_limit));
    let router = apply_security_layers(api_router, config, jwt_service, rate_limiter)?;

    Ok(ApplicationComponents {
        router,
        create_deal_draft,
        bind_deal_transaction,
        sync_deal,
        query_deals,
        siwe_auth,
        dispute_use_case,
        arbitration_use_case,
        indexer,
        repos,
        evidence_storage,
    })
}
