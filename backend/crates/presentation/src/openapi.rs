use serde_json::{json, Value};
use utoipa::openapi::schema::{KnownFormat, ObjectBuilder, Schema, SchemaFormat, SchemaType, Type};
use utoipa::openapi::{InfoBuilder, OpenApi as OpenApiSpec, RefOr, ServerBuilder};
use utoipa::{Modify, OpenApi};

use crate::dto::{
    BindTxRequest, BlockchainTransactionResponse, CreateDraftRequest, CreateDraftResponse,
    DealDetailResponse, DealEventResponse, DealHistoryResponse, DealSummaryResponse,
    DisputeDetailResponse, DisputeEvidenceResponse, HealthStatusResponse, NonceRequest,
    NonceResponse, OpenDisputeRequest, PaginatedDealSummaryResponse, ReadinessStatusResponse,
    ResolveDisputeRequest, SessionUserResponse, SyncRequest, VerifyRequest,
};

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::handlers::disputes::list_evidence,
        crate::handlers::disputes::upload_evidence,
        crate::handlers::deals::sync_deal,
        crate::handlers::disputes::open_dispute,
        crate::handlers::deals::bind_transaction,
        crate::handlers::deals::create_draft,
        crate::handlers::auth::verify,
        crate::handlers::auth::issue_nonce,
        crate::handlers::auth::logout,
        crate::handlers::arbitration::record_resolution,
        crate::handlers::health::health,
        crate::handlers::health::ready,
        crate::handlers::disputes::get_dispute,
        crate::handlers::disputes::download_evidence,
        crate::handlers::deals::list_deals,
        crate::handlers::deals::get_deal,
        crate::handlers::deals::get_history,
        crate::handlers::auth::current_session,
        crate::handlers::arbitration::list_assigned_disputes,
    ),
    components(schemas(
        DisputeEvidenceResponse,
        SyncRequest,
        DealDetailResponse,
        OpenDisputeRequest,
        DisputeDetailResponse,
        BindTxRequest,
        CreateDraftRequest,
        CreateDraftResponse,
        VerifyRequest,
        SessionUserResponse,
        NonceRequest,
        NonceResponse,
        ResolveDisputeRequest,
        HealthStatusResponse,
        ReadinessStatusResponse,
        DealSummaryResponse,
        PaginatedDealSummaryResponse,
        BlockchainTransactionResponse,
        DealEventResponse,
        DealHistoryResponse,
    )),
    modifiers(&SpringDocParityModifier)
)]
pub struct ApiDoc;

struct SpringDocParityModifier;

impl Modify for SpringDocParityModifier {
    fn modify(&self, openapi: &mut OpenApiSpec) {
        openapi.info = InfoBuilder::new()
            .title("OpenAPI definition")
            .version("v0")
            .build();
        openapi.servers = Some(vec![ServerBuilder::new()
            .url("http://localhost")
            .description(Some("Generated server url"))
            .build()]);
        openapi.tags = None;

        // Normalize `downloadEvidence` 200 response schema to string/binary
        if let Some(path_item) = openapi
            .paths
            .paths
            .get_mut("/api/v1/disputes/{disputeId}/evidence/{evidenceId}/download")
        {
            if let Some(op) = path_item.get.as_mut() {
                if let Some(RefOr::T(resp)) = op.responses.responses.get_mut("200") {
                    if let Some(content) = resp.content.get_mut("*/*") {
                        content.schema = Some(RefOr::T(Schema::Object(
                            ObjectBuilder::new()
                                .schema_type(SchemaType::Type(Type::String))
                                .format(Some(SchemaFormat::Custom("binary".to_string())))
                                .build(),
                        )));
                    }
                }
            }
        }

        // Normalize `listDeals` parameter defaults and missing parameter descriptions
        if let Some(path_item) = openapi.paths.paths.get_mut("/api/v1/deals") {
            if let Some(op) = path_item.get.as_mut() {
                if let Some(params) = op.parameters.as_mut() {
                    for param in params.iter_mut() {
                        param.description = None;
                        if let Some(RefOr::T(Schema::Object(obj))) = param.schema.as_mut() {
                            match param.name.as_str() {
                                "role" => {
                                    obj.schema_type = SchemaType::Type(Type::String);
                                    obj.default = Some(json!("all"));
                                }
                                "status" => {
                                    obj.schema_type = SchemaType::Type(Type::String);
                                }
                                "page" => {
                                    obj.schema_type = SchemaType::Type(Type::Integer);
                                    obj.format = Some(SchemaFormat::KnownFormat(KnownFormat::Int32));
                                    obj.default = Some(json!(0));
                                }
                                "size" => {
                                    obj.schema_type = SchemaType::Type(Type::Integer);
                                    obj.format = Some(SchemaFormat::KnownFormat(KnownFormat::Int32));
                                    obj.default = Some(json!(20));
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        // Strip empty parameter descriptions added automatically
        for path_item in openapi.paths.paths.values_mut() {
            for op in [
                path_item.get.as_mut(),
                path_item.post.as_mut(),
                path_item.put.as_mut(),
                path_item.delete.as_mut(),
                path_item.patch.as_mut(),
            ]
            .into_iter()
            .flatten()
            {
                if let Some(params) = op.parameters.as_mut() {
                    for p in params.iter_mut() {
                        if p.description.as_deref() == Some("") {
                            p.description = None;
                        }
                    }
                }
            }
        }
    }
}

/// Renders `/v3/api-docs` JSON matching `docs/openapi.json` SpringDoc 3.1 schema formatting
/// (collapsing OpenAPI 3.1 `["T", "null"]` unions on DTO properties and setting required lists
/// on request DTOs whose fields allow runtime deserialization before custom field validation).
pub fn openapi_json_value() -> Value {
    let mut doc = serde_json::to_value(ApiDoc::openapi()).unwrap_or(Value::Null);
    normalize_json_value(&mut doc);
    doc
}

fn normalize_json_value(root: &mut Value) {
    if let Some(paths) = root.get_mut("paths") {
        strip_null_types(paths);
        if let Some(post_ev) = paths
            .get_mut("/api/v1/disputes/{disputeId}/evidence")
            .and_then(|p| p.get_mut("post"))
            .and_then(Value::as_object_mut)
        {
            post_ev.insert(
                "requestBody".to_string(),
                json!({
                    "content": {
                        "multipart/form-data": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "file": {
                                        "type": "string",
                                        "format": "binary"
                                    }
                                }
                            }
                        }
                    }
                }),
            );
        }
    }

    if let Some(schemas) = root
        .get_mut("components")
        .and_then(|c| c.get_mut("schemas"))
        .and_then(Value::as_object_mut)
    {
        schemas.remove("EvidenceUploadFormSchema");
        for (name, schema) in schemas.iter_mut() {
            strip_null_types(schema);
            if let Some(obj) = schema.as_object_mut() {
                match name.as_str() {
                    "NonceRequest" => {
                        obj.insert("required".to_string(), json!(["address", "chainId"]));
                    }
                    "VerifyRequest" => {
                        obj.insert("required".to_string(), json!(["message", "signature"]));
                    }
                    "CreateDraftRequest" => {
                        obj.insert(
                            "required".to_string(),
                            json!([
                                "amountWei",
                                "arbiterAddress",
                                "deliveryDeadlineEpochSeconds",
                                "description",
                                "fundingDeadlineEpochSeconds",
                                "inspectionWindowSeconds",
                                "terms",
                                "title"
                            ]),
                        );
                    }
                    "BindTxRequest" => {
                        obj.insert("required".to_string(), json!(["txHash"]));
                    }
                    "OpenDisputeRequest" => {
                        obj.insert("required".to_string(), json!(["reason", "summary"]));
                    }
                    "ResolveDisputeRequest" => {
                        obj.insert("required".to_string(), json!(["rationale", "txHash"]));
                    }
                    "SyncRequest" => {
                        obj.remove("required");
                    }
                    _ => {
                        // Response schemas in SpringDoc do not list required arrays
                        obj.remove("required");
                    }
                }
            }
        }
    }
}

fn strip_null_types(val: &mut Value) {
    match val {
        Value::Object(map) => {
            if let Some(Value::Array(arr)) = map.get("type").cloned() {
                let non_null: Vec<Value> = arr
                    .into_iter()
                    .filter(|v| v.as_str() != Some("null"))
                    .collect();
                if non_null.len() == 1 {
                    if let Some(only) = non_null.into_iter().next() {
                        map.insert("type".to_string(), only);
                    }
                }
            }
            if let Some(Value::Array(one_of)) = map.get("oneOf").cloned() {
                let non_null: Vec<Value> = one_of
                    .into_iter()
                    .filter(|v| v.get("type").and_then(Value::as_str) != Some("null"))
                    .collect();
                if non_null.len() == 1 {
                    map.remove("oneOf");
                    if let Some(Value::Object(inner)) = non_null.into_iter().next() {
                        for (k, v) in inner {
                            map.insert(k, v);
                        }
                    }
                }
            }
            for child in map.values_mut() {
                strip_null_types(child);
            }
        }
        Value::Array(arr) => {
            for child in arr.iter_mut() {
                strip_null_types(child);
            }
        }
        _ => {}
    }
}
