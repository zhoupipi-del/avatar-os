#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

#[tauri::command]
fn set_ignore_cursor_events<R: Runtime>(window: WebviewWindow<R>, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

/// 全局鼠标钩子：用 Windows 低级鼠标钩子(WH_MOUSE_LL)捕获全屏光标坐标，
/// 通过 Tauri 事件 `global-mousemove` 推给前端，使桌面宠物能响应屏幕任意位置的鼠标移动。
#[cfg(windows)]
mod global_mouse {
    use std::os::raw::c_int;
    use std::ptr;
    use std::sync::Mutex;
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Instant;

    use tauri::Emitter;
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetCursorPos, GetMessageW, MSG, PM_REMOVE, SetWindowsHookExW, WH_MOUSE_LL,
    };

    // 仅设置一次，钩子回调线程读取
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    // 节流：避免高频 mousemove 洪水（约 50fps）
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    static ACTIVE: AtomicBool = AtomicBool::new(false);

    unsafe extern "system" fn mouse_proc(
        code: c_int,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        // 低级鼠标钩子仅处理 WM_MOUSEMOVE(0x0200)
        if (wparam as u32) == 0x0200 {
            if let Some(app) = APP.get() {
                let now = Instant::now();
                let mut guard = LAST.lock().unwrap();
                let fire = guard
                    .map_or(true, |t| now.saturating_duration_since(t).as_millis() >= 20);
                if fire {
                    *guard = Some(now);
                    drop(guard);
                    let mut pt: POINT = std::mem::zeroed();
                    if GetCursorPos(&mut pt) != 0 {
                        let _ = app.emit(
                            "global-mousemove",
                            serde_json::json!({ "x": pt.x, "y": pt.y }),
                        );
                    }
                }
            }
        }
        CallNextHookEx(ptr::null_mut(), code, wparam, lparam)
    }

    /// 安装全局鼠标钩子并在独立线程跑消息循环（WH_MOUSE_LL 必须在本线程收消息）。
    pub fn start(app: tauri::AppHandle) {
        if ACTIVE.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = APP.set(app);
        unsafe {
            let hook = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(mouse_proc),
                ptr::null_mut(),
                0,
            );
            if hook.is_null() {
                eprintln!("[global-mouse] SetWindowsHookExW failed");
                return;
            }
        }
        std::thread::spawn(|| {
            unsafe {
                let mut msg: MSG = std::mem::zeroed();
                // 返回 0 表示 WM_QUIT；正常情况一直阻塞收消息
                while GetMessageW(&mut msg, ptr::null_mut(), 0, 0) != 0 {
                    // 低级鼠标钩子消息在此线程投递，无需 Translate/Dispatch
                }
            }
        });
    }
}

/// 显示 / 隐藏主窗口（托盘左键 & 菜单共用）。
fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(true);
        if visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

/// 退出：走窗口 close 请求，让前端 onCloseRequested 先 flush 关系持久化再 destroy；
/// 窗口已不存在时直接退出进程。
fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    match app.get_webview_window("main") {
        Some(window) => {
            if window.close().is_err() {
                app.exit(0);
            }
        }
        None => app.exit(0),
    }
}

/// 系统托盘：窗口无边框 + 不进任务栏（skipTaskbar），托盘是用户唯一的显示/隐藏/退出入口。
fn build_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    // 名称跟随 tauri.conf.json 的 productName（送人时改成你的名字，托盘也会跟着变）
    let product = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "AvatarOS".to_string());
    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on_top", "总在最前", true, true, None::<&str>)?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "开机自动启动", true, autostart_enabled, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", format!("退出 {product}"), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &on_top, &autostart, &separator, &quit])?;

    let on_top_item = on_top.clone();
    let autostart_item = autostart.clone();
    let mut builder = TrayIconBuilder::with_id("avataros-tray")
        .tooltip(product.as_str())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "toggle" => toggle_main_window(app),
            "on_top" => {
                let checked = on_top_item.is_checked().unwrap_or(true);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_always_on_top(checked);
                }
            }
            "autostart" => {
                let want = autostart_item.is_checked().unwrap_or(false);
                let launcher = app.autolaunch();
                let result = if want { launcher.enable() } else { launcher.disable() };
                if let Err(e) = result {
                    eprintln!("[autostart] toggle failed: {e}");
                    let _ = autostart_item.set_checked(launcher.is_enabled().unwrap_or(false));
                }
            }
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// 首次运行默认开启开机自启（陪伴类应用"每天都在"是核心体验），之后完全尊重托盘里的开关。
#[cfg_attr(debug_assertions, allow(dead_code))]
fn enable_autostart_on_first_run<R: Runtime>(app: &tauri::App<R>) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    let marker = dir.join(".autostart-initialized");
    if marker.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    if let Err(e) = app.autolaunch().enable() {
        eprintln!("[autostart] enable on first run failed: {e}");
    }
    let _ = std::fs::write(&marker, b"1");
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        // 经 Rust 侧访问本机 Ollama：打包后页面来源是 http://tauri.localhost，
        // 不在 Ollama 默认 CORS 白名单里，WebView 直接 fetch 会被拦截
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![set_ignore_cursor_events])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
            }
            // 开发模式下不写系统启动项（否则会把 debug 版本注册进开机启动）
            #[cfg(not(debug_assertions))]
            enable_autostart_on_first_run(app);
            if let Err(e) = build_tray(app) {
                eprintln!("[tray] failed to create system tray: {e}");
            }
            #[cfg(windows)]
            global_mouse::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
