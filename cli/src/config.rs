//! Persistent CLI settings (`config.toml`).
//!
//! Precedence, highest first: command-line flag, environment variable,
//! configuration file.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct Config {
    /// Base URL of the RoidOTA server, e.g. `http://192.168.1.10:3000`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// API key sent as `X-API-Key`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

impl Config {
    /// Location of the configuration file. `ROIDOTA_CONFIG` overrides the
    /// platform default (`~/.config/roidota/config.toml` on Linux).
    pub fn path() -> Result<PathBuf> {
        if let Some(path) = std::env::var_os("ROIDOTA_CONFIG") {
            return Ok(PathBuf::from(path));
        }
        let base = dirs::config_dir().context("could not determine the configuration directory")?;
        Ok(base.join("roidota").join("config.toml"))
    }

    /// Loads the file, treating a missing file as an empty configuration.
    pub fn load(path: &Path) -> Result<Self> {
        match fs::read_to_string(path) {
            Ok(text) => toml::from_str(&text)
                .with_context(|| format!("invalid configuration file {}", path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error).with_context(|| format!("could not read {}", path.display())),
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("could not create {}", parent.display()))?;
        }
        let text = toml::to_string_pretty(self).context("could not serialise the configuration")?;
        write_private(path, &text).with_context(|| format!("could not write {}", path.display()))
    }
}

/// Writes the file readable by the owner only, since it may hold an API key.
#[cfg(unix)]
fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    // `mode` only applies on creation; tighten a pre-existing file too.
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    file.write_all(text.as_bytes())
}

#[cfg(not(unix))]
fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    fs::write(path, text)
}

/// Shows only the last four characters of a secret.
pub fn mask(secret: &str) -> String {
    let chars: Vec<char> = secret.chars().collect();
    if chars.len() <= 8 {
        "********".to_string()
    } else {
        let visible: String = chars[chars.len() - 4..].iter().collect();
        format!("********{visible}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_an_empty_config() {
        let dir = tempfile::tempdir().unwrap();
        let config = Config::load(&dir.path().join("nope.toml")).unwrap();
        assert_eq!(config, Config::default());
    }

    #[test]
    fn round_trips_and_creates_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("config.toml");
        let config = Config {
            url: Some("http://localhost:3000".into()),
            api_key: Some("secret-key-123456".into()),
        };
        config.save(&path).unwrap();
        assert_eq!(Config::load(&path).unwrap(), config);
    }

    #[cfg(unix)]
    #[test]
    fn config_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        Config::default().save(&path).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn rejects_malformed_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "url = [not toml").unwrap();
        assert!(Config::load(&path).is_err());
    }

    #[test]
    fn masks_secrets() {
        assert_eq!(mask("short"), "********");
        assert_eq!(mask("a-long-secret-key"), "********-key");
    }
}
