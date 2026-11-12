use chrono::{DateTime, SecondsFormat, Utc};

/// Formats UTC timestamp matching Java's `Instant.toString()` / ISO-8601 UTC behavior.
pub fn format_iso_utc(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::AutoSi, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn matches_java_instant_to_string_precision() {
        let exact_sec = Utc.with_ymd_and_hms(2026, 5, 1, 12, 30, 45).unwrap();
        assert_eq!(format_iso_utc(exact_sec), "2026-05-01T12:30:45Z");

        let millis = exact_sec + chrono::Duration::milliseconds(120);
        assert_eq!(format_iso_utc(millis), "2026-05-01T12:30:45.120Z");

        let micros = exact_sec + chrono::Duration::microseconds(123_456);
        assert_eq!(format_iso_utc(micros), "2026-05-01T12:30:45.123456Z");
    }
}
