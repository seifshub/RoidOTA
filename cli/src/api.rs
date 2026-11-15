//! Typed client for the RoidOTA REST API.

use std::path::Path;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use reqwest::blocking::{multipart, Client, RequestBuilder, Response};
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Multipart field the server reads the firmware binary from.
const UPLOAD_FIELD: &str = "userCode";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareRef {
    pub id: String,
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Firmware {
    pub id: String,
    pub name: String,
    pub version: String,
    pub size: Option<u64>,
    pub md5: Option<String>,
    pub sha256: Option<String>,
    pub s3_url: Option<String>,
    pub uploaded_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub device_id: String,
    pub ip: Option<String>,
    pub connection_status: Option<String>,
    pub current_firmware: Option<FirmwareRef>,
    pub last_seen: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    pub device_id: String,
    pub status: String,
    pub ip: Option<String>,
    pub rssi: Option<f64>,
    pub uptime: Option<f64>,
    pub free_heap: Option<f64>,
    pub last_seen: Option<String>,
    pub current_firmware: Option<FirmwareRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployment {
    pub id: String,
    pub device_id: String,
    pub firmware: FirmwareRef,
    pub status: String,
    pub applied_at: Option<String>,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
}

impl Deployment {
    /// Whether the deployment reached a final state.
    pub fn is_finished(&self) -> bool {
        !matches!(self.status.as_str(), "PENDING" | "IN_PROGRESS")
    }

    pub fn succeeded(&self) -> bool {
        self.status == "SUCCESS"
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub firmware: FirmwareRef,
    pub status: String,
    pub applied_at: Option<String>,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
}

/// Response to starting a single deployment (deploy or rollback).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentStarted {
    pub message: String,
    pub device_id: String,
    pub deployment_id: String,
    pub firmware: FirmwareRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailureReason {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    pub device_id: String,
    pub status: String,
    pub value: Option<DeploymentStarted>,
    pub reason: Option<FailureReason>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchDeployment {
    pub message: String,
    pub successful: u32,
    pub failed: u32,
    pub results: Vec<BatchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResult {
    pub message: String,
    pub firmware: Firmware,
    #[serde(default)]
    pub deployment: Option<BatchDeployment>,
}

pub struct Api {
    base: String,
    api_key: Option<String>,
    http: Client,
}

impl Api {
    pub fn new(base_url: &str, api_key: Option<String>, timeout: Duration) -> Result<Self> {
        let base = base_url.trim().trim_end_matches('/').to_string();
        if !base.starts_with("http://") && !base.starts_with("https://") {
            bail!("server URL must start with http:// or https:// (got \"{base_url}\")");
        }
        let http = Client::builder()
            .timeout(timeout)
            .user_agent(concat!("roidota-cli/", env!("CARGO_PKG_VERSION")))
            .build()
            .context("could not initialise the HTTP client")?;
        Ok(Self {
            base,
            api_key,
            http,
        })
    }

    // ------------------------------------------------------------ plumbing

    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        let builder = self.http.request(method, format!("{}{path}", self.base));
        match &self.api_key {
            Some(key) => builder.header("X-API-Key", key),
            None => builder,
        }
    }

    fn send(&self, builder: RequestBuilder) -> Result<Value> {
        let response = builder
            .send()
            .map_err(|error| self.describe_transport_error(error))?;
        self.read(response)
    }

    fn read(&self, response: Response) -> Result<Value> {
        let status = response.status();
        let text = response
            .text()
            .context("could not read the server response")?;
        let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

        if status.is_success() {
            return Ok(body);
        }

        let detail =
            server_message(&body).unwrap_or_else(|| text.trim().chars().take(200).collect());
        let hint = match status.as_u16() {
            401 => " (set the API key with --api-key, ROIDOTA_API_KEY or `roidota config set`)",
            _ => "",
        };
        Err(anyhow!(
            "server returned {} {}: {}{}",
            status.as_u16(),
            status.canonical_reason().unwrap_or(""),
            if detail.is_empty() {
                "no details"
            } else {
                &detail
            },
            hint
        ))
    }

    fn describe_transport_error(&self, error: reqwest::Error) -> anyhow::Error {
        if error.is_timeout() {
            anyhow!("request to {} timed out", self.base)
        } else if error.is_connect() {
            anyhow!("could not connect to {}: is the server running?", self.base)
        } else {
            anyhow!(error).context(format!("request to {} failed", self.base))
        }
    }

    fn get(&self, path: &str) -> Result<Value> {
        self.send(self.request(Method::GET, path))
    }

    fn post(&self, path: &str, body: &Value) -> Result<Value> {
        self.send(self.request(Method::POST, path).json(body))
    }

    fn delete(&self, path: &str) -> Result<Value> {
        self.send(self.request(Method::DELETE, path))
    }

    // ------------------------------------------------------------ endpoints

    /// Returns the health report even when the server answers 503 (degraded).
    pub fn health(&self) -> Result<Value> {
        let response = self
            .request(Method::GET, "/health")
            .send()
            .map_err(|error| self.describe_transport_error(error))?;
        if response.status().as_u16() == 503 {
            let body: Value = response.json().unwrap_or(Value::Null);
            if body.get("checks").is_some() {
                return Ok(body);
            }
            bail!("server returned 503 Service Unavailable");
        }
        self.read(response)
    }

    pub fn list_firmware(&self) -> Result<Vec<Firmware>> {
        field(self.get("/firmware")?, "firmware")
    }

    pub fn upload_firmware(
        &self,
        file: &Path,
        name: &str,
        version: Option<&str>,
        deploy_to: &[String],
    ) -> Result<UploadResult> {
        let part = multipart::Part::file(file)
            .with_context(|| format!("could not read {}", file.display()))?
            .mime_str("application/octet-stream")?;
        let mut form = multipart::Form::new()
            .part(UPLOAD_FIELD, part)
            .text("firmwareName", name.to_string());
        if let Some(version) = version {
            form = form.text("version", version.to_string());
        }

        let path = if deploy_to.is_empty() {
            "/firmware/upload/bin"
        } else {
            form = form
                .text("targetDevices", serde_json::to_string(deploy_to)?)
                .text("autoDeploy", "true");
            "/firmware/upload/deploy/bin"
        };
        parse(self.send(self.request(Method::POST, path).multipart(form))?)
    }

    pub fn delete_firmware(&self, id: &str) -> Result<Value> {
        self.delete(&format!("/firmware/{id}"))
    }

    pub fn list_devices(&self) -> Result<Vec<Device>> {
        field(self.get("/firmware/devices")?, "devices")
    }

    pub fn device_statuses(&self) -> Result<Vec<DeviceStatus>> {
        parse(self.get("/firmware/device/statuses")?)
    }

    pub fn device_status(&self, device: &str) -> Result<DeviceStatus> {
        parse(self.get(&format!("/firmware/device/{device}/status"))?)
    }

    pub fn device_history(&self, device: &str) -> Result<Vec<HistoryEntry>> {
        field(
            self.get(&format!("/firmware/device/{device}/history"))?,
            "history",
        )
    }

    pub fn delete_device(&self, device: &str) -> Result<Value> {
        self.delete(&format!("/firmware/device/{device}"))
    }

    pub fn send_command(
        &self,
        device: &str,
        command: &str,
        params: Option<Value>,
    ) -> Result<Value> {
        let mut body = json!({ "command": command });
        if let Some(params) = params {
            body["params"] = params;
        }
        self.post(&format!("/firmware/device/{device}/command"), &body)
    }

    pub fn rollback(&self, device: &str) -> Result<DeploymentStarted> {
        parse(self.post(&format!("/firmware/device/{device}/rollback"), &json!({}))?)
    }

    pub fn deploy(&self, device: &str, firmware_id: &str) -> Result<DeploymentStarted> {
        parse(self.post(
            &format!("/firmware/deploy/{device}"),
            &json!({ "firmwareId": firmware_id }),
        )?)
    }

    pub fn deploy_batch(&self, devices: &[String], firmware_id: &str) -> Result<BatchDeployment> {
        parse(self.post(
            "/firmware/deploy/batch",
            &json!({ "firmwareId": firmware_id, "devices": devices }),
        )?)
    }

    pub fn deployment(&self, id: &str) -> Result<Deployment> {
        field(
            self.get(&format!("/firmware/deployments/{id}"))?,
            "deployment",
        )
    }

    pub fn deployments(&self) -> Result<Vec<Deployment>> {
        field(self.get("/firmware/deployments/history")?, "deployments")
    }

    pub fn pending_deployments(&self) -> Result<Vec<PendingDeployment>> {
        field(self.get("/firmware/deployments/pending")?, "pending")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDeployment {
    pub id: String,
    pub device_id: String,
    pub firmware: FirmwareRef,
    pub status: Option<String>,
    pub applied_at: Option<String>,
}

/// NestJS reports errors as `{ "message": "..." }` or `{ "message": ["...", "..."] }`.
fn server_message(body: &Value) -> Option<String> {
    match body.get("message")? {
        Value::String(message) => Some(message.clone()),
        Value::Array(items) => Some(
            items
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("; "),
        ),
        _ => None,
    }
}

fn parse<T: DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value)
        .context("unexpected response from the server (is the CLI up to date?)")
}

fn field<T: DeserializeOwned>(mut value: Value, name: &str) -> Result<T> {
    let inner = value
        .get_mut(name)
        .map(Value::take)
        .ok_or_else(|| anyhow!("unexpected response from the server: missing \"{name}\""))?;
    parse(inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_urls_without_a_scheme() {
        assert!(Api::new("localhost:3000", None, Duration::from_secs(1)).is_err());
        assert!(Api::new("http://localhost:3000/", None, Duration::from_secs(1)).is_ok());
    }

    #[test]
    fn extracts_string_and_array_messages() {
        assert_eq!(
            server_message(&json!({ "message": "Device x not found" })).as_deref(),
            Some("Device x not found")
        );
        assert_eq!(
            server_message(&json!({ "message": ["a is bad", "b is bad"] })).as_deref(),
            Some("a is bad; b is bad")
        );
        assert_eq!(server_message(&json!({ "error": "x" })), None);
    }

    #[test]
    fn deployment_states() {
        let mut deployment: Deployment = serde_json::from_value(json!({
            "id": "d", "deviceId": "esp_1", "status": "IN_PROGRESS",
            "firmware": { "id": "f", "name": "app", "version": "1" }
        }))
        .unwrap();
        assert!(!deployment.is_finished());
        deployment.status = "TIMEOUT".into();
        assert!(deployment.is_finished() && !deployment.succeeded());
        deployment.status = "SUCCESS".into();
        assert!(deployment.succeeded());
    }
}
