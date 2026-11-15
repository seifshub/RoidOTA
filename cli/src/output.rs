//! Human-readable rendering helpers.

use comfy_table::{presets, ContentArrangement, Table};

pub const NONE: &str = "-";

pub fn table(headers: &[&str], rows: Vec<Vec<String>>) -> String {
    let mut table = Table::new();
    table
        .load_preset(presets::UTF8_HORIZONTAL_ONLY)
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(headers.to_vec());
    for row in rows {
        table.add_row(row);
    }
    table.to_string()
}

pub fn or_none(value: Option<&str>) -> String {
    match value {
        Some(text) if !text.is_empty() => text.to_string(),
        _ => NONE.to_string(),
    }
}

/// `2026-11-15T01:21:24.609Z` -> `2026-11-15 01:21:24` (UTC, as sent by the server).
pub fn timestamp(value: Option<&str>) -> String {
    match value {
        Some(text) if text.len() >= 19 && text.as_bytes()[10] == b'T' => {
            format!("{} {}", &text[..10], &text[11..19])
        }
        other => or_none(other),
    }
}

pub fn bytes(size: Option<u64>) -> String {
    match size {
        None => NONE.to_string(),
        Some(size) if size < 1024 => format!("{size} B"),
        Some(size) if size < 1024 * 1024 => format!("{:.1} KB", size as f64 / 1024.0),
        Some(size) => format!("{:.2} MB", size as f64 / (1024.0 * 1024.0)),
    }
}

/// Device uptime arrives in milliseconds.
pub fn uptime(millis: Option<f64>) -> String {
    let Some(millis) = millis else {
        return NONE.to_string();
    };
    let seconds = (millis / 1000.0).max(0.0) as u64;
    let (days, hours, minutes) = (
        seconds / 86_400,
        seconds % 86_400 / 3600,
        seconds % 3600 / 60,
    );
    if days > 0 {
        format!("{days}d {hours}h")
    } else if hours > 0 {
        format!("{hours}h {minutes:02}m")
    } else if minutes > 0 {
        format!("{minutes}m {:02}s", seconds % 60)
    } else {
        format!("{seconds}s")
    }
}

pub fn firmware(name: &str, version: &str) -> String {
    format!("{name} {version}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_timestamps() {
        assert_eq!(
            timestamp(Some("2026-11-15T01:21:24.609Z")),
            "2026-11-15 01:21:24"
        );
        assert_eq!(timestamp(Some("yesterday")), "yesterday");
        assert_eq!(timestamp(None), "-");
    }

    #[test]
    fn formats_sizes() {
        assert_eq!(bytes(Some(512)), "512 B");
        assert_eq!(bytes(Some(4096)), "4.0 KB");
        assert_eq!(bytes(Some(1_572_864)), "1.50 MB");
        assert_eq!(bytes(None), "-");
    }

    #[test]
    fn formats_uptime() {
        assert_eq!(uptime(Some(42_000.0)), "42s");
        assert_eq!(uptime(Some(125_000.0)), "2m 05s");
        assert_eq!(uptime(Some(3_723_000.0)), "1h 02m");
        assert_eq!(uptime(Some(90_000_000.0)), "1d 1h");
        assert_eq!(uptime(None), "-");
    }
}
