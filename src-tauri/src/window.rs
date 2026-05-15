#[cfg(desktop)]
use tauri::Theme;
use tauri::{LogicalSize, Runtime, WebviewWindow, Window};

#[cfg(test)]
use std::sync::{Mutex, OnceLock};

#[cfg(test)]
type WindowAppearanceOverride =
    Box<dyn Fn(&Window, &str) -> Result<(), String> + Send + Sync + 'static>;

#[cfg(test)]
static WINDOW_APPEARANCE_OVERRIDE: OnceLock<Mutex<Option<WindowAppearanceOverride>>> =
    OnceLock::new();

#[cfg(desktop)]
const DEFAULT_RESTORE_LOGICAL_WIDTH: f64 = 1200.0;
#[cfg(desktop)]
const DEFAULT_RESTORE_LOGICAL_HEIGHT: f64 = 700.0;
#[cfg(desktop)]
const DEFAULT_SIZE_TOLERANCE_PX: u32 = 8;

#[cfg(desktop)]
fn is_near_default_physical_size(width: u32, height: u32) -> bool {
    width.abs_diff(DEFAULT_RESTORE_LOGICAL_WIDTH as u32) <= DEFAULT_SIZE_TOLERANCE_PX
        && height.abs_diff(DEFAULT_RESTORE_LOGICAL_HEIGHT as u32) <= DEFAULT_SIZE_TOLERANCE_PX
}

#[cfg(desktop)]
fn is_near_scaled_default_size(width: u32, height: u32, scale_factor: f64) -> bool {
    if scale_factor <= 1.0 {
        return false;
    }
    let scaled_width = (DEFAULT_RESTORE_LOGICAL_WIDTH / scale_factor).round() as u32;
    let scaled_height = (DEFAULT_RESTORE_LOGICAL_HEIGHT / scale_factor).round() as u32;
    width.abs_diff(scaled_width) <= DEFAULT_SIZE_TOLERANCE_PX
        && height.abs_diff(scaled_height) <= DEFAULT_SIZE_TOLERANCE_PX
}

#[cfg(desktop)]
pub(crate) fn repair_unscaled_default_window_size<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let inner_size = window.inner_size().map_err(|error| error.to_string())?;
    if !is_near_default_physical_size(inner_size.width, inner_size.height)
        && !is_near_scaled_default_size(inner_size.width, inner_size.height, scale_factor)
    {
        return Ok(());
    }
    window
        .set_size(LogicalSize::new(
            DEFAULT_RESTORE_LOGICAL_WIDTH,
            DEFAULT_RESTORE_LOGICAL_HEIGHT,
        ))
        .map_err(|error| error.to_string())?;
    let _ = window.center();
    Ok(())
}

#[cfg(target_os = "macos")]
fn apply_macos_window_appearance(window: &Window, theme: &str) -> Result<(), String> {
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
        NSWindow,
    };

    let ns_window = window.ns_window().map_err(|error| error.to_string())?;
    let ns_window: &NSWindow = unsafe { &*ns_window.cast() };

    if theme == "system" {
        ns_window.setAppearance(None);
        return Ok(());
    }

    let appearance_name = unsafe {
        if theme == "light" {
            NSAppearanceNameAqua
        } else {
            NSAppearanceNameDarkAqua
        }
    };
    let appearance =
        NSAppearance::appearanceNamed(appearance_name).ok_or("NSAppearance missing")?;
    ns_window.setAppearance(Some(&appearance));
    Ok(())
}

#[cfg(target_os = "macos")]
fn perform_macos_window_zoom(ns_window: *mut std::ffi::c_void) -> Result<(), String> {
    use objc2_app_kit::NSWindow;

    if ns_window.is_null() {
        return Err("NSWindow missing".to_string());
    }
    let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
    ns_window.performZoom(None);
    Ok(())
}

pub(crate) fn apply_window_appearance(window: &Window, theme: &str) -> Result<(), String> {
    #[cfg(test)]
    if let Some(handler) = WINDOW_APPEARANCE_OVERRIDE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap()
        .as_ref()
    {
        return handler(window, theme);
    }

    #[cfg(desktop)]
    {
        let next_theme = match theme {
            "light" => Some(Theme::Light),
            "dark" | "dim" => Some(Theme::Dark),
            _ => None,
        };
        let _ = window.set_theme(next_theme);
    }

    #[cfg(target_os = "macos")]
    {
        let window_handle = window.clone();
        let theme_value = theme.to_string();
        window
            .run_on_main_thread(move || {
                let _ = apply_macos_window_appearance(&window_handle, theme_value.as_str());
            })
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn perform_window_zoom(window: &Window) -> Result<bool, String> {
    let window_handle = window.clone();
    window
        .run_on_main_thread(move || {
            if let Ok(ns_window) = window_handle.ns_window() {
                let _ = perform_macos_window_zoom(ns_window);
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn perform_window_zoom(_window: &Window) -> Result<bool, String> {
    Ok(false)
}

#[cfg(target_os = "macos")]
pub(crate) fn perform_webview_window_zoom<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<bool, String> {
    let window_handle = window.clone();
    window
        .run_on_main_thread(move || {
            if let Ok(ns_window) = window_handle.ns_window() {
                let _ = perform_macos_window_zoom(ns_window);
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn perform_webview_window_zoom<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
) -> Result<bool, String> {
    Ok(false)
}

#[cfg(target_os = "ios")]
pub(crate) fn configure_ios_webview_edge_to_edge(
    webview_window: &tauri::WebviewWindow,
) -> Result<(), String> {
    use objc2::runtime::AnyObject;

    webview_window
        .with_webview(|webview| unsafe {
            let wk_webview = webview.inner().cast::<AnyObject>();
            if !wk_webview.is_null() {
                let scroll_view: *mut AnyObject = objc2::msg_send![wk_webview, scrollView];
                if !scroll_view.is_null() {
                    // UIScrollViewContentInsetAdjustmentNever
                    let adjustment_never: isize = 2;
                    let () = objc2::msg_send![
                        scroll_view,
                        setContentInsetAdjustmentBehavior: adjustment_never
                    ];
                    let () = objc2::msg_send![
                        scroll_view,
                        setAutomaticallyAdjustsScrollIndicatorInsets: false
                    ];
                }
            }

            let view_controller = webview.view_controller().cast::<AnyObject>();
            if !view_controller.is_null() {
                // UIRectEdgeAll
                let all_edges: usize = 15;
                let () = objc2::msg_send![view_controller, setEdgesForExtendedLayout: all_edges];
                let () = objc2::msg_send![
                    view_controller,
                    setExtendedLayoutIncludesOpaqueBars: true
                ];
            }
        })
        .map_err(|error| error.to_string())
}
