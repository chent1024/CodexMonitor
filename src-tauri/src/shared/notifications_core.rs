use std::process::Command;

pub(crate) fn send_notification_fallback_core(title: String, body: String) -> Result<(), String> {
    #[cfg(all(target_os = "macos", debug_assertions))]
    {
        return send_macos_applescript_notification(&title, &body);
    }

    #[cfg(target_os = "linux")]
    {
        return send_linux_notify_send_notification(&title, &body);
    }

    #[cfg(not(any(target_os = "linux", all(target_os = "macos", debug_assertions))))]
    {
        let _ = (title, body);
        Err("Notification fallback is only available on Linux or macOS debug builds.".to_string())
    }
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn send_macos_applescript_notification(title: &str, body: &str) -> Result<(), String> {
    let escape = |value: &str| value.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display notification \"{}\" with title \"{}\"",
        escape(body),
        escape(title)
    );

    let status = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|error| format!("Failed to run osascript: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("osascript exited with status: {status}"))
    }
}

#[cfg(target_os = "linux")]
fn send_linux_notify_send_notification(title: &str, body: &str) -> Result<(), String> {
    let status = Command::new("notify-send")
        .arg("--app-name")
        .arg("CodexMonitor")
        .arg(title)
        .arg(body)
        .status()
        .map_err(|error| format!("Failed to run notify-send: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("notify-send exited with status: {status}"))
    }
}
