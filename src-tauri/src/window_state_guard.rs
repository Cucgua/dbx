const DEFAULT_LOGICAL_WIDTH: f64 = 1280.0;
const DEFAULT_LOGICAL_HEIGHT: f64 = 800.0;

use tauri::{AppHandle, Manager, PhysicalSize, Runtime, WebviewWindow, Window};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PhysicalWindowSize {
    pub(crate) width: u32,
    pub(crate) height: u32,
}

pub(crate) fn corrected_window_size(
    window_size: PhysicalWindowSize,
    monitor_size: PhysicalWindowSize,
    scale_factor: f64,
) -> Option<PhysicalWindowSize> {
    if window_size.width <= monitor_size.width && window_size.height <= monitor_size.height {
        return None;
    }

    Some(default_window_size_for_monitor(monitor_size, scale_factor))
}

pub(crate) fn enforce_main_window_bounds<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if enforce_webview_window_bounds(&window) {
            let _ = app.save_window_state(StateFlags::all());
        }
    }
}

pub(crate) fn enforce_window_bounds<R: Runtime>(window: &Window<R>) {
    if enforce_tauri_window_bounds(window) {
        let _ = window.app_handle().save_window_state(StateFlags::all());
    }
}

fn enforce_webview_window_bounds<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    match window.current_monitor() {
        Ok(Some(monitor)) => {
            let monitor_size = monitor.size();
            match window.outer_size() {
                Ok(window_size) => {
                    if let Some(corrected) = corrected_window_size(
                        PhysicalWindowSize { width: window_size.width, height: window_size.height },
                        PhysicalWindowSize { width: monitor_size.width, height: monitor_size.height },
                        monitor.scale_factor(),
                    ) {
                        let _ = window.set_size(PhysicalSize::new(corrected.width, corrected.height));
                        let _ = window.center();
                        true
                    } else {
                        false
                    }
                }
                Err(_) => false,
            }
        }
        _ => false,
    }
}

fn enforce_tauri_window_bounds<R: Runtime>(window: &Window<R>) -> bool {
    match window.current_monitor() {
        Ok(Some(monitor)) => {
            let monitor_size = monitor.size();
            match window.outer_size() {
                Ok(window_size) => {
                    if let Some(corrected) = corrected_window_size(
                        PhysicalWindowSize { width: window_size.width, height: window_size.height },
                        PhysicalWindowSize { width: monitor_size.width, height: monitor_size.height },
                        monitor.scale_factor(),
                    ) {
                        let _ = window.set_size(PhysicalSize::new(corrected.width, corrected.height));
                        let _ = window.center();
                        true
                    } else {
                        false
                    }
                }
                Err(_) => false,
            }
        }
        _ => false,
    }
}

fn default_window_size_for_monitor(monitor_size: PhysicalWindowSize, scale_factor: f64) -> PhysicalWindowSize {
    let fallback_width = (DEFAULT_LOGICAL_WIDTH * scale_factor).round() as u32;
    let fallback_height = (DEFAULT_LOGICAL_HEIGHT * scale_factor).round() as u32;

    PhysicalWindowSize {
        width: fallback_width.min(monitor_size.width),
        height: fallback_height.min(monitor_size.height),
    }
}

#[cfg(test)]
mod tests {
    use super::{corrected_window_size, PhysicalWindowSize};

    #[test]
    fn clamps_width_that_exceeds_current_monitor() {
        let corrected = corrected_window_size(
            PhysicalWindowSize { width: 43_152, height: 1_888 },
            PhysicalWindowSize { width: 3_024, height: 1_964 },
            2.0,
        );

        assert_eq!(corrected, Some(PhysicalWindowSize { width: 2_560, height: 1_600 }));
    }

    #[test]
    fn leaves_window_size_unchanged_when_it_fits_monitor() {
        let corrected = corrected_window_size(
            PhysicalWindowSize { width: 1_280, height: 800 },
            PhysicalWindowSize { width: 1_920, height: 1_080 },
            1.0,
        );

        assert_eq!(corrected, None);
    }

    #[test]
    fn clamps_default_size_to_smaller_monitor() {
        let corrected = corrected_window_size(
            PhysicalWindowSize { width: 2_400, height: 1_400 },
            PhysicalWindowSize { width: 1_920, height: 1_080 },
            2.0,
        );

        assert_eq!(corrected, Some(PhysicalWindowSize { width: 1_920, height: 1_080 }));
    }
}
