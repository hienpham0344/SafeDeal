use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Command;

use serde_json::Value;

#[test]
fn enforces_clean_architecture_crate_dag_and_zero_openssl() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let output = Command::new(env!("CARGO"))
        .arg("metadata")
        .arg("--format-version")
        .arg("1")
        .arg("--manifest-path")
        .arg(manifest_dir.join("Cargo.toml"))
        .output()
        .expect("Failed to execute cargo metadata");
    assert!(
        output.status.success(),
        "cargo metadata failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let metadata: Value =
        serde_json::from_slice(&output.stdout).expect("Invalid JSON from cargo metadata");
    let packages = metadata["packages"]
        .as_array()
        .expect("cargo metadata packages should be an array");

    let mut normal_deps: HashMap<String, HashSet<String>> = HashMap::new();
    let mut all_package_names: HashSet<String> = HashSet::new();

    for pkg in packages {
        let name = pkg["name"].as_str().expect("package name");
        all_package_names.insert(name.to_string());
        if name.starts_with("safedeal-") {
            let mut deps = HashSet::new();
            if let Some(arr) = pkg["dependencies"].as_array() {
                for dep in arr {
                    let kind = dep["kind"].as_str();
                    // null kind means normal runtime dependency
                    if kind.is_none() {
                        if let Some(dep_name) = dep["name"].as_str() {
                            deps.insert(dep_name.to_string());
                        }
                    }
                }
            }
            normal_deps.insert(name.to_string(), deps);
        }
    }

    assert!(
        !all_package_names.contains("openssl-sys"),
        "Pure rustls policy violated: openssl-sys found in resolved dependency tree"
    );

    let shared_deps = normal_deps.get("safedeal-shared").expect("safedeal-shared");
    for forbidden in [
        "safedeal-domain",
        "safedeal-application",
        "safedeal-infrastructure",
        "safedeal-presentation",
        "sqlx",
        "axum",
        "tower",
        "tower-http",
        "reqwest",
        "alloy-provider",
    ] {
        assert!(
            !shared_deps.contains(forbidden),
            "safedeal-shared must not depend on {forbidden}"
        );
    }

    let domain_deps = normal_deps.get("safedeal-domain").expect("safedeal-domain");
    for forbidden in [
        "safedeal-application",
        "safedeal-infrastructure",
        "safedeal-presentation",
        "sqlx",
        "axum",
        "tower",
        "tower-http",
        "reqwest",
        "alloy-provider",
        "alloy",
    ] {
        assert!(
            !domain_deps.contains(forbidden),
            "safedeal-domain must remain isolated from outer layers and frameworks (found {forbidden})"
        );
    }
    assert!(domain_deps.contains("safedeal-shared"));

    let app_deps = normal_deps
        .get("safedeal-application")
        .expect("safedeal-application");
    for forbidden in [
        "safedeal-infrastructure",
        "safedeal-presentation",
        "sqlx",
        "axum",
        "tower",
        "tower-http",
        "reqwest",
        "alloy-provider",
        "alloy",
    ] {
        assert!(
            !app_deps.contains(forbidden),
            "safedeal-application must not depend on infrastructure/presentation/frameworks (found {forbidden})"
        );
    }
    assert!(app_deps.contains("safedeal-shared"));
    assert!(app_deps.contains("safedeal-domain"));

    let pres_deps = normal_deps
        .get("safedeal-presentation")
        .expect("safedeal-presentation");
    for forbidden in ["safedeal-infrastructure", "sqlx"] {
        assert!(
            !pres_deps.contains(forbidden),
            "safedeal-presentation must not depend on {forbidden}"
        );
    }
}
