//! Runs the compiled binary against a mock RoidOTA server.

use std::fs;

use assert_cmd::Command;
use mockito::{Matcher, Server};
use predicates::prelude::*;
use serde_json::json;

const FW_ID: &str = "3f2b0c1e-8a55-4a0b-9d5e-0d2a8f1c7b11";
const DEP_ID: &str = "9a1b2c3d-0000-4000-8000-000000000001";

/// The binary, isolated from the developer's own configuration and environment.
fn roidota(server: &Server) -> Command {
    let mut command = bare();
    command.env("ROIDOTA_URL", server.url());
    command
}

fn bare() -> Command {
    let mut command = Command::cargo_bin("roidota").unwrap();
    command
        .env_remove("ROIDOTA_URL")
        .env_remove("ROIDOTA_API_KEY")
        .env("ROIDOTA_CONFIG", "/nonexistent/roidota/config.toml")
        .env("ROIDOTA_POLL_INTERVAL_MS", "10");
    command
}

fn firmware_json() -> serde_json::Value {
    json!({
        "id": FW_ID, "name": "blink", "version": "1.2.0", "size": 4096,
        "md5": "0cc175b9c0f1b6a831c399e269772661", "sha256": "ab".repeat(32),
        "s3Url": "http://s3/blink.bin", "uploadedAt": "2026-11-15T01:21:24.609Z"
    })
}

fn deployment_json(status: &str, error: Option<&str>) -> String {
    json!({
        "status": "success",
        "deployment": {
            "id": DEP_ID, "deviceId": "esp_1", "status": status,
            "firmware": { "id": FW_ID, "name": "blink", "version": "1.2.0" },
            "appliedAt": "2026-11-15T01:30:00.000Z", "completedAt": null, "errorMessage": error
        }
    })
    .to_string()
}

fn started_json() -> String {
    json!({
        "status": "pending", "message": "Firmware deployment initiated for esp_1",
        "deviceId": "esp_1", "deploymentId": DEP_ID,
        "firmware": { "id": FW_ID, "name": "blink", "version": "1.2.0" }
    })
    .to_string()
}

#[test]
fn health_reports_each_dependency() {
    let mut server = Server::new();
    server
        .mock("GET", "/health")
        .with_body(
            json!({ "status": "ok", "service": "RoidOTA Backend", "version": "1.0.0",
                    "checks": { "database": "up", "mqtt": "up", "storage": "up" } })
            .to_string(),
        )
        .create();

    roidota(&server)
        .arg("health")
        .assert()
        .success()
        .stdout(predicate::str::contains("RoidOTA Backend 1.0.0 - ok"))
        .stdout(predicate::str::contains("mqtt      up"));
}

#[test]
fn degraded_health_fails_but_still_prints_the_report() {
    let mut server = Server::new();
    server
        .mock("GET", "/health")
        .with_status(503)
        .with_body(
            json!({ "status": "degraded", "service": "RoidOTA Backend", "version": "1.0.0",
                    "checks": { "database": "up", "mqtt": "down", "storage": "up" } })
            .to_string(),
        )
        .create();

    roidota(&server)
        .arg("health")
        .assert()
        .code(1)
        .stdout(predicate::str::contains("mqtt      down"));
}

#[test]
fn sends_the_api_key_and_renders_a_table() {
    let mut server = Server::new();
    let mock = server
        .mock("GET", "/firmware")
        .match_header("x-api-key", "secret-key-0123456789")
        .with_body(json!({ "status": "success", "firmware": [firmware_json()] }).to_string())
        .create();

    roidota(&server)
        .args(["--api-key", "secret-key-0123456789", "firmware", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("blink"))
        .stdout(predicate::str::contains("4.0 KB"))
        .stdout(predicate::str::contains("2026-11-15 01:21:24"))
        .stdout(predicate::str::contains(FW_ID));
    mock.assert();
}

#[test]
fn json_output_is_machine_readable() {
    let mut server = Server::new();
    server
        .mock("GET", "/firmware")
        .with_body(json!({ "status": "success", "firmware": [firmware_json()] }).to_string())
        .create();

    let output = roidota(&server)
        .args(["firmware", "list", "--json"])
        .output()
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(parsed[0]["id"], FW_ID);
    assert_eq!(parsed[0]["uploadedAt"], "2026-11-15T01:21:24.609Z");
}

#[test]
fn explains_authentication_failures() {
    let mut server = Server::new();
    server
        .mock("GET", "/firmware/devices")
        .with_status(401)
        .with_body(r#"{"message":"Missing or invalid API key","statusCode":401}"#)
        .create();

    roidota(&server)
        .args(["device", "list"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "401 Unauthorized: Missing or invalid API key",
        ))
        .stderr(predicate::str::contains("ROIDOTA_API_KEY"));
}

#[test]
fn joins_validation_messages() {
    let mut server = Server::new();
    server
        .mock("POST", "/firmware/device/esp_1/command")
        .match_body(Matcher::Json(
            json!({ "command": "BAD", "params": { "level": 3 } }),
        ))
        .with_status(400)
        .with_body(r#"{"message":["command must be lower-case","params is odd"],"statusCode":400}"#)
        .create();

    roidota(&server)
        .args([
            "device",
            "command",
            "esp_1",
            "BAD",
            "--params",
            r#"{"level":3}"#,
        ])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "command must be lower-case; params is odd",
        ));
}

#[test]
fn reports_an_unreachable_server() {
    bare()
        .args(["--url", "http://127.0.0.1:9", "--timeout", "2", "health"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "could not connect to http://127.0.0.1:9",
        ));
}

#[test]
fn rejects_a_url_without_scheme() {
    bare()
        .args(["--url", "localhost:3000", "health"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "must start with http:// or https://",
        ));
}

#[test]
fn uploads_a_binary_as_multipart() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("blink.bin");
    fs::write(&file, [0xe9, 1, 2, 3]).unwrap();

    let mut server = Server::new();
    let mock = server
        .mock("POST", "/firmware/upload/bin")
        .match_header("content-type", Matcher::Regex("multipart/form-data".into()))
        .match_body(Matcher::AllOf(vec![
            Matcher::Regex(r#"name="userCode"; filename="blink.bin""#.into()),
            Matcher::Regex(r#"name="firmwareName"\s+blink\s"#.into()),
            Matcher::Regex(r#"name="version"\s+1.2.0\s"#.into()),
        ]))
        .with_status(201)
        .with_body(
            json!({ "status": "success", "message": "uploaded", "firmware": firmware_json() })
                .to_string(),
        )
        .create();

    roidota(&server)
        .args([
            "firmware",
            "upload",
            file.to_str().unwrap(),
            "--fw-version",
            "1.2.0",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Uploaded blink 1.2.0 (4.0 KB)"))
        .stdout(predicate::str::contains(
            "md5:    0cc175b9c0f1b6a831c399e269772661",
        ));
    mock.assert();
}

#[test]
fn refuses_to_upload_missing_or_empty_files() {
    let dir = tempfile::tempdir().unwrap();
    let empty = dir.path().join("empty.bin");
    fs::write(&empty, []).unwrap();
    let server = Server::new();

    roidota(&server)
        .args(["firmware", "upload", empty.to_str().unwrap()])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("is empty"));
    roidota(&server)
        .args(["firmware", "upload", "/nonexistent/fw.bin"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("could not read"));
}

#[test]
fn deploys_by_name_and_waits_for_success() {
    let mut server = Server::new();
    server
        .mock("GET", "/firmware")
        .with_body(json!({ "status": "success", "firmware": [firmware_json()] }).to_string())
        .create();
    let deploy = server
        .mock("POST", "/firmware/deploy/esp_1")
        .match_body(Matcher::Json(json!({ "firmwareId": FW_ID })))
        .with_status(201)
        .with_body(started_json())
        .create();
    // The device first reports the update in progress, then success.
    let path = format!("/firmware/deployments/{DEP_ID}");
    server
        .mock("GET", path.as_str())
        .with_body(deployment_json("IN_PROGRESS", None))
        .expect(1)
        .create();
    server
        .mock("GET", path.as_str())
        .with_body(deployment_json("SUCCESS", None))
        .create();

    roidota(&server)
        .args(["deploy", "blink@1.2.0", "esp_1", "--wait"])
        .assert()
        .success()
        .stdout(predicate::str::contains(DEP_ID))
        .stderr(predicate::str::contains("esp_1: IN_PROGRESS"))
        .stderr(predicate::str::contains("esp_1: SUCCESS"));
    deploy.assert();
}

#[test]
fn a_failed_deployment_exits_with_code_2() {
    let mut server = Server::new();
    server
        .mock("POST", "/firmware/deploy/esp_1")
        .with_status(201)
        .with_body(started_json())
        .create();
    server
        .mock("GET", format!("/firmware/deployments/{DEP_ID}").as_str())
        .with_body(deployment_json("FAILED", Some("Not enough space")))
        .create();

    roidota(&server)
        .args(["deploy", FW_ID, "esp_1", "--wait"])
        .assert()
        .code(2)
        .stderr(predicate::str::contains("esp_1: FAILED (Not enough space)"));
}

#[test]
fn waiting_gives_up_after_the_timeout() {
    let mut server = Server::new();
    server
        .mock("GET", format!("/firmware/deployments/{DEP_ID}").as_str())
        .with_body(deployment_json("PENDING", None))
        .expect_at_least(2)
        .create();

    roidota(&server)
        .args(["deployment", "wait", DEP_ID, "--wait-timeout", "1"])
        .assert()
        .code(2)
        .stderr(predicate::str::contains("Gave up waiting after 1s"));
}

#[test]
fn batch_deploy_reports_rejections() {
    let mut server = Server::new();
    server
        .mock("POST", "/firmware/deploy/batch")
        .match_body(Matcher::Json(json!({ "firmwareId": FW_ID, "devices": ["esp_1", "ghost"] })))
        .with_status(201)
        .with_body(
            json!({
                "status": "completed", "message": "Deployment completed: 1 successful, 1 failed",
                "successful": 1, "failed": 1,
                "results": [
                    { "deviceId": "esp_1", "status": "fulfilled",
                      "value": serde_json::from_str::<serde_json::Value>(&started_json()).unwrap() },
                    { "deviceId": "ghost", "status": "rejected",
                      "reason": { "statusCode": 404, "message": "Device ghost not found" } }
                ]
            })
            .to_string(),
        )
        .create();

    roidota(&server)
        .args(["deploy", FW_ID, "esp_1", "ghost"])
        .assert()
        .code(2)
        .stdout(predicate::str::contains("started"))
        .stdout(predicate::str::contains("rejected  Device ghost not found"));
}

#[test]
fn destructive_commands_need_confirmation() {
    let mut server = Server::new();
    let delete = server
        .mock("DELETE", "/firmware/device/esp_1")
        .with_body(r#"{"status":"success","message":"Device esp_1 deleted successfully"}"#)
        .expect(1)
        .create();

    // stdin is not a terminal here, so the command must refuse without --yes.
    roidota(&server)
        .args(["device", "delete", "esp_1"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("pass --yes"));
    roidota(&server)
        .args(["device", "delete", "esp_1", "--yes"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Deleted device esp_1"));
    delete.assert();
}

#[test]
fn config_is_saved_masked_and_used() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config.toml");
    let mut server = Server::new();
    let mock = server
        .mock("GET", "/firmware/test")
        .match_header("x-api-key", "saved-key-0123456789")
        .create();
    server
        .mock("GET", "/firmware/devices")
        .match_header("x-api-key", "saved-key-0123456789")
        .with_body(r#"{"status":"success","devices":[]}"#)
        .create();

    let with_config = || {
        let mut command = Command::cargo_bin("roidota").unwrap();
        command
            .env_remove("ROIDOTA_URL")
            .env_remove("ROIDOTA_API_KEY")
            .env("ROIDOTA_CONFIG", &config);
        command
    };

    with_config()
        .args([
            "config",
            "set",
            "--server-url",
            &format!("{}/", server.url()),
            "--key",
            "saved-key-0123456789",
        ])
        .assert()
        .success();
    with_config()
        .args(["config", "show"])
        .assert()
        .success()
        .stdout(predicate::str::contains(server.url()))
        .stdout(predicate::str::contains("********6789"))
        .stdout(predicate::str::contains("saved-key").not());
    with_config()
        .args(["device", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No devices registered yet."));

    drop(mock);
}
