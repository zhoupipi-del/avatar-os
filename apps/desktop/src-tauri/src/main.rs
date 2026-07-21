#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, Runtime, WebviewWindow};

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![set_ignore_cursor_events])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            window.set_always_on_top(true).unwrap();
            #[cfg(windows)]
            global_mouse::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
