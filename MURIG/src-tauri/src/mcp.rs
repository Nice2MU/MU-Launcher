use std::collections::HashMap;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};

pub struct McpPending {
    pub senders: Mutex<HashMap<String, oneshot::Sender<Value>>>,
}

impl McpPending {
    pub fn new() -> Self {
        Self {
            senders: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
struct McpCallPayload {
    #[serde(rename = "reqId")]
    req_id: String,
    tool: String,
    args: Value,
}

#[derive(Deserialize)]
struct JsonRpcReq {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

fn tool_definitions() -> Value {
    json!({
        "tools": [
            {
                "name": "open_psd",
                "description": "Load a .psd file from disk into MURIG and optionally select a character by name.",
                "inputSchema": {
                    "type": "object",
                    "required": ["path"],
                    "properties": {
                        "path": { "type": "string" },
                        "character": { "type": "string" }
                    }
                }
            },
            {
                "name": "open_project",
                "description": "Load a .murig.json project file from disk into MURIG.",
                "inputSchema": {
                    "type": "object",
                    "required": ["path"],
                    "properties": { "path": { "type": "string" } }
                }
            },
            {
                "name": "get_character",
                "description": "Get the active character's bones, parts (bounds/pivots/bindings), params, and warnings.",
                "inputSchema": { "type": "object", "properties": {} }
            },
            {
                "name": "add_bone",
                "description": "Add a new bone to the active character.",
                "inputSchema": {
                    "type": "object",
                    "required": ["name", "parentId", "x", "y"],
                    "properties": {
                        "id": { "type": "string" },
                        "name": { "type": "string" },
                        "parentId": { "type": ["string", "null"] },
                        "x": { "type": "number" },
                        "y": { "type": "number" },
                        "length": { "type": "number" },
                        "visualAngle": { "type": "number" }
                    }
                }
            },
            {
                "name": "set_bone",
                "description": "Update an existing bone's position, rotation, scale, length, visualAngle, parentId, or name.",
                "inputSchema": {
                    "type": "object",
                    "required": ["id"],
                    "properties": {
                        "id": { "type": "string" },
                        "name": { "type": "string" },
                        "parentId": { "type": ["string", "null"] },
                        "x": { "type": "number" },
                        "y": { "type": "number" },
                        "rotation": { "type": "number" },
                        "scaleX": { "type": "number" },
                        "scaleY": { "type": "number" },
                        "length": { "type": "number" },
                        "visualAngle": { "type": "number" }
                    }
                }
            },
            {
                "name": "delete_bone",
                "description": "Delete a bone (except root).",
                "inputSchema": {
                    "type": "object",
                    "required": ["id"],
                    "properties": { "id": { "type": "string" } }
                }
            },
            {
                "name": "bind_part",
                "description": "Link a part (layer) to a bone and optionally update its pivot or parallax.",
                "inputSchema": {
                    "type": "object",
                    "required": ["partId", "boneId"],
                    "properties": {
                        "partId": { "type": "string" },
                        "boneId": { "type": "string" },
                        "pivotX": { "type": "number" },
                        "pivotY": { "type": "number" },
                        "parallax": { "type": "number" }
                    }
                }
            },
            {
                "name": "create_part_group",
                "description": "Group multiple parts together regardless of layer z-order so they move as one piece.",
                "inputSchema": {
                    "type": "object",
                    "required": ["name", "partIds"],
                    "properties": {
                        "name": { "type": "string" },
                        "partIds": { "type": "array", "items": { "type": "string" } },
                        "boneId": { "type": "string" }
                    }
                }
            },
            {
                "name": "bind_group",
                "description": "Bind an entire part group to a bone.",
                "inputSchema": {
                    "type": "object",
                    "required": ["groupId", "boneId"],
                    "properties": {
                        "groupId": { "type": "string" },
                        "boneId": { "type": "string" }
                    }
                }
            },
            {
                "name": "set_param",
                "description": "Set an L2D parameter value (e.g. AngleX, AngleY, Breath, ArmL).",
                "inputSchema": {
                    "type": "object",
                    "required": ["id", "value"],
                    "properties": {
                        "id": { "type": "string" },
                        "value": { "type": "number" }
                    }
                }
            },
            {
                "name": "set_skinning",
                "description": "Enable or disable smooth mesh skinning on a part or part group.",
                "inputSchema": {
                    "type": "object",
                    "required": ["targetType", "id", "skinned"],
                    "properties": {
                        "targetType": { "type": "string", "enum": ["part", "group"] },
                        "id": { "type": "string" },
                        "skinned": { "type": "boolean" }
                    }
                }
            },
            {
                "name": "paint_weights",
                "description": "Paint bone weights onto skinned meshes around (x, y) within radius.",
                "inputSchema": {
                    "type": "object",
                    "required": ["boneId", "x", "y", "radius"],
                    "properties": {
                        "boneId": { "type": "string" },
                        "x": { "type": "number" },
                        "y": { "type": "number" },
                        "radius": { "type": "number" },
                        "strength": { "type": "number" },
                        "erase": { "type": "boolean" }
                    }
                }
            },
            {
                "name": "create_clip",
                "description": "Create a new empty animation clip and make it active.",
                "inputSchema": {
                    "type": "object",
                    "required": ["name"],
                    "properties": {
                        "name": { "type": "string" },
                        "duration": { "type": "number" },
                        "loop": { "type": "boolean" }
                    }
                }
            },
            {
                "name": "delete_clip",
                "description": "Delete an animation clip by id or name.",
                "inputSchema": {
                    "type": "object",
                    "required": ["id"],
                    "properties": { "id": { "type": "string" } }
                }
            },
            {
                "name": "apply_preset",
                "description": "Create and play an animation preset (idle, wave, nod) on the active character.",
                "inputSchema": {
                    "type": "object",
                    "required": ["preset"],
                    "properties": {
                        "preset": { "type": "string", "enum": ["idle", "wave", "nod"] }
                    }
                }
            },
            {
                "name": "set_keyframe",
                "description": "Insert or update a bone keyframe on the active animation clip.",
                "inputSchema": {
                    "type": "object",
                    "required": ["targetId", "prop", "time", "value"],
                    "properties": {
                        "targetId": { "type": "string" },
                        "prop": { "type": "string", "enum": ["x", "y", "rotation", "scaleX", "scaleY"] },
                        "time": { "type": "number" },
                        "value": { "type": "number" }
                    }
                }
            },
            {
                "name": "reset_pose",
                "description": "Reset all bone rotations/scales and parameters to default.",
                "inputSchema": { "type": "object", "properties": {} }
            },
            {
                "name": "render_preview",
                "description": "Capture the current character viewport as a PNG image (base64).",
                "inputSchema": { "type": "object", "properties": {} }
            }
        ]
    })
}

async fn write_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &str,
) {
    let resp = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, Accept, Mcp-Session-Id\r\n\
         Connection: close\r\n\r\n\
         {body}",
        body.len()
    );
    let _ = stream.write_all(resp.as_bytes()).await;
}

async fn handle_client(mut stream: TcpStream, app: AppHandle, pending: Arc<McpPending>) {
    let mut reader = BufReader::new(&mut stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await.unwrap_or(0) == 0 {
        return;
    }

    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0);
            }
        }
    }

    let mut body_buf = vec![0u8; content_length];
    if content_length > 0 {
        if reader.read_exact(&mut body_buf).await.is_err() {
            return;
        }
    }
    drop(reader);

    if request_line.starts_with("OPTIONS ") {
        write_http_response(&mut stream, "204 No Content", "text/plain", "").await;
        return;
    }

    if request_line.starts_with("GET ") {
        let health = json!({ "name": "murig-mcp", "version": "0.1.0", "status": "ok" }).to_string();
        write_http_response(&mut stream, "200 OK", "application/json", &health).await;
        return;
    }

    let req: JsonRpcReq = match serde_json::from_slice(&body_buf) {
        Ok(r) => r,
        Err(e) => {
            let err = json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32700, "message": format!("Parse error: {e}") }
            })
            .to_string();
            write_http_response(&mut stream, "400 Bad Request", "application/json", &err).await;
            return;
        }
    };

    // Notifications (no id)
    if req.id.is_none() {
        write_http_response(&mut stream, "202 Accepted", "application/json", "").await;
        return;
    }
    let id = req.id.unwrap();

    let response = match req.method.as_str() {
        "initialize" => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "murig", "version": "0.1.0" }
            }
        }),
        "tools/list" => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": tool_definitions()
        }),
        "tools/call" => {
            let params = req.params.unwrap_or_else(|| json!({}));
            let tool_name = params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

            let req_id = format!(
                "mcp_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            );
            let (tx, rx) = oneshot::channel::<Value>();
            {
                let mut map = pending.senders.lock().await;
                map.insert(req_id.clone(), tx);
            }

            let emit_res = app.emit(
                "murig://mcp-call",
                McpCallPayload {
                    req_id: req_id.clone(),
                    tool: tool_name.clone(),
                    args,
                },
            );

            if let Err(e) = emit_res {
                let mut map = pending.senders.lock().await;
                map.remove(&req_id);
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32000, "message": format!("Emit failed: {e}") }
                })
            } else {
                match tokio::time::timeout(std::time::Duration::from_secs(15), rx).await {
                    Ok(Ok(val)) => {
                        if let Some(img_b64) = val.get("imageBase64").and_then(|v| v.as_str()) {
                            json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": {
                                    "content": [{
                                        "type": "image",
                                        "data": img_b64,
                                        "mimeType": "image/png"
                                    }]
                                }
                            })
                        } else {
                            let text = serde_json::to_string_pretty(&val).unwrap_or_default();
                            json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": {
                                    "content": [{ "type": "text", "text": text }]
                                }
                            })
                        }
                    }
                    Ok(Err(_)) | Err(_) => {
                        let mut map = pending.senders.lock().await;
                        map.remove(&req_id);
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": -32001, "message": "MURIG frontend did not respond in time" }
                        })
                    }
                }
            }
        }
        other => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32601, "message": format!("Method not found: {other}") }
        }),
    };

    write_http_response(
        &mut stream,
        "200 OK",
        "application/json",
        &response.to_string(),
    )
    .await;
}

pub fn spawn_mcp_server(app: AppHandle) {
    let pending = Arc::new(McpPending::new());
    app.manage(pending.clone());

    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:7820").await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("MURIG MCP failed to bind 127.0.0.1:7820: {e}");
                return;
            }
        };
        loop {
            if let Ok((stream, _)) = listener.accept().await {
                let app_clone = app.clone();
                let pending_clone = pending.clone();
                tauri::async_runtime::spawn(async move {
                    handle_client(stream, app_clone, pending_clone).await;
                });
            }
        }
    });
}
