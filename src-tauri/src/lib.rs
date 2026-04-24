use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::io::{Read, Write};
use portable_pty::{native_pty_system, CommandBuilder, PtySize, Child, MasterPty};
use tauri::{State, Emitter, Manager};

struct TerminalState {
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    child: Arc<Mutex<Option<Box<dyn Child + Send>>>>,
}




#[tauri::command]
fn save_note(dir: String, title: String, content: String) -> Result<String, String> {
    // Join exactly what the user typed (with space replacement)
    let path = PathBuf::from(dir).join(title.replace(" ", "_"));
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(format!("Saved to {:?}", path))
}

#[derive(serde::Serialize)]
struct FileItem {
    name: String,
    is_dir: bool,
}

#[tauri::command]
fn list_files(dir: String) -> Result<Vec<FileItem>, String> {
    let paths = fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for path in paths {
        let path = path.map_err(|e| e.to_string())?.path();
        let is_dir = path.is_dir();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            items.push(FileItem {
                name: name.to_string(),
                is_dir,
            });
        }
    }
    Ok(items)
}

#[tauri::command]
fn read_file(dir: String, name: String) -> Result<String, String> {
    let path = PathBuf::from(dir).join(name);
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(dir: String, name: String) -> Result<String, String> {
    let path = PathBuf::from(dir).join(name);
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok("Deleted successfully".to_string())
}

#[tauri::command]
fn rename_file(dir: String, old_name: String, new_name: String) -> Result<String, String> {
    let old_path = PathBuf::from(&dir).join(old_name);
    let new_path = PathBuf::from(&dir).join(new_name);
    fs::rename(old_path, new_path).map_err(|e| e.to_string())?;
    Ok("Renamed successfully".to_string())
}

#[tauri::command]
fn create_dir(dir: String, name: String) -> Result<String, String> {
    let path = PathBuf::from(dir).join(name);
    fs::create_dir(path).map_err(|e| e.to_string())?;
    Ok("Directory created".to_string())
}

#[tauri::command]
fn create_file(dir: String, name: String) -> Result<String, String> {
    let path = PathBuf::from(dir).join(name);
    fs::File::create(path).map_err(|e| e.to_string())?;
    Ok("File created".to_string())
}

#[tauri::command]
fn spawn_terminal(state: State<TerminalState>, window: tauri::Window, dir: Option<String>) -> Result<(), String> {
    println!("Terminal spawn requested for dir: {:?}", dir);
    
    // 1. Cleanup existing state first
    {
        let mut child_lock = state.child.lock().unwrap();
        if let Some(mut child) = child_lock.take() {
            println!("Cleaning up existing terminal process...");
            let _ = child.kill();
        }
        
        let mut writer_lock = state.writer.lock().unwrap();
        *writer_lock = None;
        
        let mut master_lock = state.master.lock().unwrap();
        *master_lock = None;
    }

    // 2. Initialize PTY system
    let pty_system = native_pty_system();
    let cwd = dir.map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    
    let pair = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| e.to_string())?;

    let shell = if cfg!(target_os = "windows") { "powershell.exe" } else { "bash" };
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(cwd);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // 3. Store new state
    {
        *state.child.lock().unwrap() = Some(child);
        *state.writer.lock().unwrap() = Some(writer);
        *state.master.lock().unwrap() = Some(pair.master);
    }

    // 4. Start reader thread with stability checks
    let window_clone = window.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 4096]; // Larger buffer for performance
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 { break; }
            let data = String::from_utf8_lossy(&buffer[..n]).to_string();
            // Ignore errors if the window is closed/closing
            if let Err(_) = window_clone.emit("terminal-output", data) {
                break;
            }
        }
        println!("Terminal reader thread exiting.");
    });

    println!("Terminal spawned successfully.");
    Ok(())
}

#[tauri::command]
fn write_to_terminal(state: State<TerminalState>, data: String) -> Result<(), String> {
    if let Some(writer) = state.writer.lock().unwrap().as_mut() {
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_terminal(state: State<TerminalState>, rows: u16, cols: u16) -> Result<(), String> {
    if let Some(master) = state.master.lock().unwrap().as_ref() {
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_maximize(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

// ===== Browser WebView Panel =====

#[tauri::command]
async fn open_browser(window: tauri::Window, url: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    use tauri::{webview::WebviewBuilder, WebviewUrl, LogicalPosition, LogicalSize, Manager};
    
    // If already exists, just reposition it
    if let Some(existing) = window.get_webview("browser-panel") {
        existing.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        existing.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
        return Ok(());
    }
    
    let parsed_url: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;
    
    let webview_builder = WebviewBuilder::new(
        "browser-panel",
        WebviewUrl::External(parsed_url),
    );
    
    window.add_child(
        webview_builder,
        LogicalPosition::new(x, y),
        LogicalSize::new(width, height),
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn hide_browser(window: tauri::Window) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize, Manager};
    if let Some(webview) = window.get_webview("browser-panel") {
        // Move offscreen but keep a functional size so Gemini renders correctly
        webview.set_position(LogicalPosition::new(-9999.0, -9999.0)).map_err(|e| e.to_string())?;
        webview.set_size(LogicalSize::new(1024.0, 768.0)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_browser(window: tauri::Window) -> Result<(), String> {
    use tauri::Manager;
    if let Some(webview) = window.get_webview("browser-panel") {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn navigate_browser(window: tauri::Window, url: String) -> Result<(), String> {
    use tauri::Manager;
    if let Some(webview) = window.get_webview("browser-panel") {
        let parsed_url: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;
        webview.navigate(parsed_url).map_err(|e| e.to_string())?;
    } else {
        return Err("Browser not open".to_string());
    }
    Ok(())
}

#[tauri::command]
async fn resize_browser(window: tauri::Window, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize, Manager};
    if let Some(webview) = window.get_webview("browser-panel") {
        webview.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        webview.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn eval_browser(window: tauri::Window, js: String) -> Result<(), String> {
    use tauri::Manager;
    if let Some(webview) = window.get_webview("browser-panel") {
        webview.eval(&js).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn send_to_gemini(window: tauri::Window, message: String) -> Result<(), String> {
    use tauri::Manager;
    if let Some(webview) = window.get_webview("browser-panel") {
        let escaped = message.replace('\\', "\\\\").replace('`', "\\`").replace('"', "\\\"").replace('\'', "\\'").replace('\n', "\\n");
        let js = format!(r#"
            (function() {{
                function findElementInShadow(root, selectors, predicate) {{
                    for (const s of selectors) {{
                        const els = root.querySelectorAll(s);
                        for (const el of els) {{
                            if (!predicate || predicate(el)) return el;
                        }}
                    }}
                    const children = root.querySelectorAll('*');
                    for (const child of children) {{
                        if (child.shadowRoot) {{
                            const found = findElementInShadow(child.shadowRoot, selectors, predicate);
                            if (found) return found;
                        }}
                    }}
                    return null;
                }}

                const input = findElementInShadow(document, [
                    '.ql-editor[contenteditable="true"]',
                    'rich-textarea .textarea',
                    'div[contenteditable="true"][role="textbox"]',
                    'textarea[aria-label*="prompt"]',
                    'div[contenteditable="true"]'
                ]);

                if (input) {{
                    input.focus();
                    input.click();
                    
                    // Simulate a real keypress to "wake up" the editor
                    const keyOpts = {{ key: 'a', code: 'KeyA', keyCode: 65, which: 65, bubbles: true }};
                    input.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
                    input.dispatchEvent(new KeyboardEvent('keyup', keyOpts));

                    const fullText = "{}";
                    try {{
                        document.execCommand('selectAll', false, null);
                        document.execCommand('delete', false, null);
                        
                        if (input.tagName === 'TEXTAREA') {{
                            document.execCommand('insertText', false, fullText);
                        }} else {{
                            // Rich text editors often truncate 'insertText' at the first newline.
                            // Convert newlines to HTML breaks and use insertHTML to preserve formatting.
                            const htmlText = fullText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                            document.execCommand('insertHTML', false, htmlText);
                            
                            // If insertHTML was blocked or failed, fallback to standard text insertion
                            if (input.textContent.trim() === '') {{
                                document.execCommand('insertText', false, fullText);
                            }}
                        }}
                    }} catch (e) {{
                        if (input.tagName === 'TEXTAREA') input.value = fullText;
                        else input.textContent = fullText;
                    }}

                    // Fire all events
                    ['input', 'change', 'keydown', 'keyup', 'beforeinput'].forEach(type => {{
                        input.dispatchEvent(new Event(type, {{ bubbles: true, cancelable: true }}));
                    }});

                    const clickSend = () => {{
                        const sendBtn = findElementInShadow(document, ['button', 'div[role="button"]', 'a[role="button"]'], (el) => {{
                            const label = (el.getAttribute('aria-label') || '').toLowerCase();
                            const title = (el.getAttribute('title') || '').toLowerCase();
                            const content = el.innerHTML.toLowerCase();
                            return label.includes('send') || title.includes('send') || content.includes('send') || content.includes('mat-icon') || label.includes('submit');
                        }});

                        if (sendBtn) {{
                            // Forcibly remove disabled states before clicking
                            sendBtn.disabled = false;
                            sendBtn.removeAttribute('disabled');
                            sendBtn.setAttribute('aria-disabled', 'false');
                            
                            // Full lifecycle simulation
                            sendBtn.focus();
                            sendBtn.dispatchEvent(new MouseEvent('mouseover', {{ bubbles: true }}));
                            sendBtn.dispatchEvent(new MouseEvent('mousedown', {{ bubbles: true }}));
                            sendBtn.click();
                            sendBtn.dispatchEvent(new MouseEvent('mouseup', {{ bubbles: true }}));
                            return true;
                        }}
                        return false;
                    }};

                    // Try multiple times as the button might take a moment to enable
                    setTimeout(() => {{
                        if (!clickSend()) {{
                            // Try standard Enter
                            input.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }}));
                            // Try Ctrl+Enter (often used in multi-line text areas)
                            input.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, ctrlKey: true }}));
                        }}
                    }}, 600);
                    
                    // One final desperate attempt
                    setTimeout(() => {{
                        clickSend();
                        input.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }}));
                    }}, 1200);

        }}
            }})()
        "#, escaped);
        webview.eval(&js).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
async fn read_gemini_response(window: tauri::Window) -> Result<String, String> {
    use tauri::Manager;
    if let Some(webview) = window.get_webview("browser-panel") {
        // Inject JS to read latest response and encode into URL hash
        let js = r#"
            (function() {
                const msgs = document.querySelectorAll('message-content, .model-response-text, [data-message-author-role="model"], .response-container-content');
                const count = msgs.length;
                if (count > 0) {
                    const last = msgs[count - 1];
                    const text = last.innerText || last.textContent || '';
                    // Check if model is still generating (look for loading indicators)
                    const isLoading = document.querySelector('.loading-indicator, .response-loading, mat-progress-bar, [aria-label*="loading"], .thinking-indicator');
                    const done = !isLoading ? '1' : '0';
                    // Encode response into URL hash
                    try {
                        const payload = btoa(unescape(encodeURIComponent(text.trim())));
                        window.location.hash = '#CP:' + count + ':' + done + ':' + payload;
                    } catch(e) {}
                }
            })()
        "#;
        webview.eval(js).map_err(|e| e.to_string())?;

        // Brief pause for eval to execute
        std::thread::sleep(std::time::Duration::from_millis(80));

        // Read URL to get the hash
        match webview.url() {
            Ok(url) => {
                let url_str = url.to_string();
                if let Some(hash_start) = url_str.find("#CP:") {
                    let data = &url_str[hash_start + 4..];
                    return Ok(data.to_string());
                }
            }
            Err(_) => {}
        }
    }
    Ok("".to_string())
}

#[tauri::command]
fn copy_file(src: String, dest: String) -> Result<String, String> {
    fs::copy(src, dest).map_err(|e| e.to_string())?;
    Ok("Copied successfully".to_string())
}

#[tauri::command]
fn move_file(src: String, dest: String) -> Result<String, String> {
    fs::rename(src, dest).map_err(|e| e.to_string())?;
    Ok("Moved successfully".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(TerminalState {
            master: Arc::new(Mutex::new(None)),
            writer: Arc::new(Mutex::new(None)),
            child: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            save_note, 
            list_files, 
            read_file, 
            delete_file, 
            rename_file, 
            create_dir, 
            create_file,
            copy_file,
            move_file,
            spawn_terminal,
            write_to_terminal,
            resize_terminal,
            minimize_window,
            toggle_maximize,
            close_window,
            open_browser,
            hide_browser,
            close_browser,
            navigate_browser,
            resize_browser,
            eval_browser,
            send_to_gemini,
            read_gemini_response
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<TerminalState>();
                let mut child_lock = state.child.lock().unwrap();
                if let Some(mut child) = child_lock.take() {
                    println!("App exiting: Killing terminal process...");
                    let _ = child.kill();
                }
            }
        });
}
