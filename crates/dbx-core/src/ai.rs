use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, LazyLock};
use tokio::sync::{Notify, RwLock};

// ---------------------------------------------------------------------------
// Stream cancel registry
// ---------------------------------------------------------------------------

static AI_STREAMS: LazyLock<RwLock<HashMap<String, Arc<Notify>>>> = LazyLock::new(|| RwLock::new(HashMap::new()));

pub async fn register_stream(session_id: &str) -> Arc<Notify> {
    let notify = Arc::new(Notify::new());
    AI_STREAMS.write().await.insert(session_id.to_string(), notify.clone());
    notify
}

pub async fn cancel_stream(session_id: &str) -> bool {
    if let Some(notify) = AI_STREAMS.read().await.get(session_id) {
        notify.notify_one();
        true
    } else {
        false
    }
}

pub async fn unregister_stream(session_id: &str) {
    AI_STREAMS.write().await.remove(session_id);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    #[serde(alias = "anthropic")]
    Claude,
    Openai,
    Gemini,
    Deepseek,
    Qwen,
    Ollama,
    #[serde(rename = "openai-compatible")]
    OpenaiCompatible,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AiApiStyle {
    #[default]
    Completions,
    Responses,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub provider: AiProvider,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_style: AiApiStyle,
    #[serde(default)]
    pub proxy_enabled: bool,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default = "default_enable_thinking")]
    pub enable_thinking: bool,
    #[serde(default)]
    pub schema_research: SchemaResearchModelConfig,
}

fn default_enable_thinking() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaResearchModelConfig {
    #[serde(default = "default_schema_research_enabled")]
    pub enabled: bool,
    #[serde(default = "default_schema_research_use_main_model")]
    pub use_main_model: bool,
    #[serde(default)]
    pub provider: Option<AiProvider>,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_style: Option<AiApiStyle>,
    #[serde(default)]
    pub proxy_enabled: bool,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default = "default_schema_research_max_tool_rounds")]
    pub max_tool_rounds: u32,
    #[serde(default = "default_schema_research_max_output_tokens")]
    pub max_output_tokens: u32,
}

impl Default for SchemaResearchModelConfig {
    fn default() -> Self {
        Self {
            enabled: default_schema_research_enabled(),
            use_main_model: default_schema_research_use_main_model(),
            provider: None,
            api_key: String::new(),
            endpoint: String::new(),
            model: String::new(),
            api_style: None,
            proxy_enabled: false,
            proxy_url: String::new(),
            max_tool_rounds: default_schema_research_max_tool_rounds(),
            max_output_tokens: default_schema_research_max_output_tokens(),
        }
    }
}

fn default_schema_research_enabled() -> bool {
    true
}

fn default_schema_research_use_main_model() -> bool {
    true
}

fn default_schema_research_max_tool_rounds() -> u32 {
    4
}

fn default_schema_research_max_output_tokens() -> u32 {
    1800
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCompletionRequest {
    pub config: AiConfig,
    pub system_prompt: String,
    pub messages: Vec<AiMessage>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRawChatRequest {
    pub config: AiConfig,
    pub system_prompt: String,
    pub messages: Vec<serde_json::Value>,
    pub tools: Vec<serde_json::Value>,
    pub tool_choice: Option<serde_json::Value>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_format: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRawToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRawToolCallDelta {
    pub index: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments_delta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRawChatResponse {
    pub content: String,
    pub tool_calls: Vec<AiRawToolCall>,
    pub raw_message: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiStreamChunk {
    pub session_id: String,
    pub delta: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_delta: Option<AiRawToolCallDelta>,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, alias = "toolTraces", skip_serializing_if = "Option::is_none")]
    pub tool_traces: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeline: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversation {
    pub id: String,
    pub title: String,
    pub connection_name: String,
    pub database: String,
    pub messages: Vec<AiChatMessage>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiModelInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

pub fn resolve_endpoint(config: &AiConfig) -> String {
    let ep = config.endpoint.trim().trim_end_matches('/');
    if matches!(config.provider, AiProvider::Gemini) {
        if ep.ends_with(":generateContent") || ep.ends_with(":streamGenerateContent") {
            return ep.to_string();
        }
        let base = ep.trim_end_matches("/v1beta");
        return format!("{base}/v1beta/models/{}:generateContent", config.model);
    }
    if ep.ends_with("/chat/completions") || ep.ends_with("/responses") || ep.ends_with("/messages") {
        return ep.to_string();
    }
    match config.provider {
        AiProvider::Claude => format!("{ep}/messages"),
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::Ollama
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => {
            if config.api_style == AiApiStyle::Responses {
                format!("{ep}/responses")
            } else {
                format!("{ep}/chat/completions")
            }
        }
        AiProvider::Gemini => unreachable!(),
    }
}

fn resolve_gemini_stream_endpoint(config: &AiConfig) -> String {
    let endpoint = resolve_endpoint(config);
    if endpoint.ends_with(":streamGenerateContent") {
        endpoint
    } else {
        endpoint.replace(":generateContent", ":streamGenerateContent")
    }
}

pub fn resolve_model_list_endpoint(config: &AiConfig) -> Result<String, String> {
    if matches!(config.provider, AiProvider::Gemini) {
        return Err("Model listing is only supported for OpenAI-compatible and Claude providers".to_string());
    }

    let ep = config.endpoint.trim().trim_end_matches('/');
    if ep.is_empty() {
        return Err("Endpoint is required".to_string());
    }
    if ep.ends_with("/models") {
        return Ok(ep.to_string());
    }

    let base = ep
        .strip_suffix("/chat/completions")
        .or_else(|| ep.strip_suffix("/responses"))
        .or_else(|| ep.strip_suffix("/messages"))
        .unwrap_or(ep)
        .trim_end_matches('/');

    Ok(format!("{base}/models"))
}

pub fn stream_data_payload(line: &str) -> Option<&str> {
    let line = line.trim();
    if line.is_empty() || line.starts_with(':') || line.starts_with("event:") || line.starts_with("id:") {
        return None;
    }
    if let Some(data) = line.strip_prefix("data:") {
        return Some(data.trim_start());
    }
    if line.starts_with('{') {
        return Some(line);
    }
    None
}

pub fn claude_stream_text(event: &serde_json::Value) -> Option<&str> {
    if event["type"] == "content_block_delta" {
        return event["delta"]["text"].as_str();
    }
    None
}

pub fn openai_stream_text(event: &serde_json::Value) -> Option<&str> {
    event["choices"]
        .get(0)
        .and_then(|choice| choice["delta"]["content"].as_str().or_else(|| choice["message"]["content"].as_str()))
        .or_else(|| event["content"].as_str())
        .filter(|text| !text.is_empty())
}

pub fn openai_stream_reasoning(event: &serde_json::Value) -> Option<&str> {
    event["choices"]
        .get(0)
        .and_then(|choice| choice["delta"]["reasoning_content"].as_str())
        .filter(|text| !text.is_empty())
}

pub fn openai_stream_tool_call_deltas(event: &serde_json::Value) -> Vec<AiRawToolCallDelta> {
    event["choices"]
        .get(0)
        .and_then(|choice| choice["delta"]["tool_calls"].as_array())
        .map(|calls| {
            calls
                .iter()
                .filter_map(|call| {
                    let index = call["index"].as_u64()? as usize;
                    let function = &call["function"];
                    Some(AiRawToolCallDelta {
                        index,
                        id: call["id"].as_str().map(ToString::to_string),
                        name: function["name"].as_str().map(ToString::to_string),
                        arguments_delta: function["arguments"].as_str().map(ToString::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Debug, Default)]
struct OpenAiStreamToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Debug, Default)]
pub struct OpenAiRawChatStreamAccumulator {
    content: String,
    reasoning_content: String,
    tool_calls: Vec<OpenAiStreamToolCallAccumulator>,
}

impl OpenAiRawChatStreamAccumulator {
    pub fn push_content(&mut self, delta: &str) {
        self.content.push_str(delta);
    }

    pub fn push_reasoning(&mut self, delta: &str) {
        self.reasoning_content.push_str(delta);
    }

    pub fn push_tool_call_delta(&mut self, delta: &AiRawToolCallDelta) {
        while self.tool_calls.len() <= delta.index {
            self.tool_calls.push(OpenAiStreamToolCallAccumulator::default());
        }
        let call = &mut self.tool_calls[delta.index];
        if let Some(id) = &delta.id {
            call.id = id.clone();
        }
        if let Some(name) = &delta.name {
            call.name = name.clone();
        }
        if let Some(arguments_delta) = &delta.arguments_delta {
            call.arguments.push_str(arguments_delta);
        }
    }

    pub fn finish(self) -> AiRawChatResponse {
        let tool_calls = self
            .tool_calls
            .into_iter()
            .filter(|call| !call.name.is_empty())
            .map(|call| AiRawToolCall { id: call.id, name: call.name, arguments: call.arguments })
            .collect::<Vec<_>>();
        let mut raw_message = json!({
            "role": "assistant",
            "content": self.content,
        });
        if !self.reasoning_content.is_empty() {
            raw_message["reasoning_content"] = json!(self.reasoning_content);
        }
        if !tool_calls.is_empty() {
            raw_message["tool_calls"] = json!(tool_calls
                .iter()
                .map(|call| {
                    json!({
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.name,
                            "arguments": call.arguments,
                        },
                    })
                })
                .collect::<Vec<_>>());
        }

        AiRawChatResponse {
            content: raw_message["content"].as_str().unwrap_or_default().to_string(),
            tool_calls,
            raw_message,
        }
    }
}

pub fn responses_stream_text(event: &serde_json::Value) -> Option<&str> {
    match event["type"].as_str() {
        Some("response.output_text.delta") => event["delta"].as_str(),
        Some(event_type) if event_type.contains("reasoning") => None,
        Some(_) => None,
        None => event["delta"].as_str(),
    }
    .filter(|s| !s.is_empty())
}

pub fn responses_stream_reasoning(event: &serde_json::Value) -> Option<&str> {
    match event["type"].as_str() {
        Some("response.reasoning_summary_text.delta") => event["delta"].as_str(),
        _ => None,
    }
    .filter(|s| !s.is_empty())
}

fn should_request_responses_reasoning_summary(config: &AiConfig) -> bool {
    if !config.enable_thinking {
        return false;
    }
    let model = config.model.to_ascii_lowercase();
    model.starts_with("gpt-5")
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
        || model.contains("reasoning")
}

fn add_responses_reasoning_options(body: &mut serde_json::Value, config: &AiConfig) {
    if should_request_responses_reasoning_summary(config) {
        body["reasoning"] = json!({
            "summary": "auto",
        });
    }
}

fn openai_compatible_temperature(config: &AiConfig, requested: Option<f32>) -> Option<f32> {
    if matches!(config.provider, AiProvider::Deepseek) && config.enable_thinking {
        return None;
    }
    Some(requested.unwrap_or(0.2))
}

fn add_openai_compatible_sampling_options(body: &mut serde_json::Value, config: &AiConfig, temperature: Option<f32>) {
    if let Some(temperature) = openai_compatible_temperature(config, temperature) {
        body["temperature"] = json!(temperature);
    }
}

fn add_openai_compatible_thinking_options(body: &mut serde_json::Value, config: &AiConfig) {
    if matches!(config.provider, AiProvider::Deepseek) {
        if config.enable_thinking {
            body["reasoning_effort"] = json!("high");
        }
        body["thinking"] = json!({
            "type": if config.enable_thinking { "enabled" } else { "disabled" },
        });
        return;
    }

    if !config.enable_thinking {
        body["extra_body"] = json!({
            "chat_template_kwargs": { "enable_thinking": false }
        });
    }
}

fn build_openai_compatible_chat_body(
    config: &AiConfig,
    messages: serde_json::Value,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    stream: bool,
) -> serde_json::Value {
    let mut body = json!({
        "model": config.model,
        "messages": messages,
        "max_tokens": max_tokens.unwrap_or(2048),
    });
    if stream {
        body["stream"] = json!(true);
    }
    add_openai_compatible_sampling_options(&mut body, config, temperature);
    add_openai_compatible_thinking_options(&mut body, config);
    body
}

fn apply_raw_chat_request_options(body: &mut serde_json::Value, request: &AiRawChatRequest) {
    if matches!(request.config.provider, AiProvider::Deepseek) {
        if let Some(response_format) = &request.response_format {
            body["response_format"] = response_format.clone();
        }
    }
}

fn is_schema_doc_debug_label(label: &str) -> bool {
    matches!(label, "schema-doc-extraction" | "schema-doc-json-repair")
}

fn raw_chat_debug_label(request: &AiRawChatRequest) -> Option<&str> {
    request.debug_label.as_deref().filter(|label| is_schema_doc_debug_label(label))
}

fn log_schema_doc_raw_chat_request(request: &AiRawChatRequest, body: &serde_json::Value) {
    let Some(label) = raw_chat_debug_label(request) else {
        return;
    };
    log_schema_doc_ai_json(label, "request", body);
}

fn log_schema_doc_raw_chat_response(request: &AiRawChatRequest, raw_message: &serde_json::Value) {
    let Some(label) = raw_chat_debug_label(request) else {
        return;
    };
    log_schema_doc_ai_json(label, "response", raw_message);
}

fn log_schema_doc_raw_chat_error(request: &AiRawChatRequest, data: &serde_json::Value) {
    let Some(label) = raw_chat_debug_label(request) else {
        return;
    };
    log_schema_doc_ai_json(label, "error", data);
}

fn log_schema_doc_ai_json(label: &str, phase: &str, value: &serde_json::Value) {
    let text = serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string());
    log_schema_doc_ai_text(label, phase, &text);
}

fn log_schema_doc_ai_text(label: &str, phase: &str, text: &str) {
    const CHUNK_BYTES: usize = 8000;
    if text.is_empty() {
        log::info!("[schema-doc-ai][{label}][{phase}][1/1]");
        return;
    }
    let chunks = text.as_bytes().chunks(CHUNK_BYTES).collect::<Vec<_>>();
    for (index, chunk) in chunks.iter().enumerate() {
        log::info!(
            "[schema-doc-ai][{label}][{phase}][{}/{}]\n{}",
            index + 1,
            chunks.len(),
            String::from_utf8_lossy(chunk)
        );
    }
}

pub fn gemini_text(data: &serde_json::Value) -> String {
    data["candidates"]
        .get(0)
        .and_then(|candidate| candidate["content"]["parts"].as_array())
        .map(|parts| parts.iter().filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join(""))
        .unwrap_or_default()
}

pub fn extract_error(data: &serde_json::Value) -> Option<String> {
    data["error"]["message"].as_str().or_else(|| data["error"].as_str()).map(ToString::to_string)
}

pub fn build_responses_input(system_prompt: &str, messages: &[AiMessage]) -> serde_json::Value {
    let mut input = Vec::new();
    if !system_prompt.is_empty() {
        input.push(json!({
            "role": "developer",
            "content": system_prompt,
        }));
    }
    for m in messages {
        input.push(json!({
            "role": m.role,
            "content": m.content,
        }));
    }
    json!(input)
}

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

fn validate_config(config: &AiConfig) -> Result<(), String> {
    if !matches!(config.provider, AiProvider::Ollama) && config.api_key.trim().is_empty() {
        return Err("API key is required".to_string());
    }
    if config.endpoint.trim().is_empty() {
        return Err("Endpoint is required".to_string());
    }
    if config.model.trim().is_empty() {
        return Err("Model is required".to_string());
    }
    Ok(())
}

fn validate_model_list_config(config: &AiConfig) -> Result<(), String> {
    if !matches!(config.provider, AiProvider::Ollama) && config.api_key.trim().is_empty() {
        return Err("API key is required".to_string());
    }
    resolve_model_list_endpoint(config).map(|_| ())
}

fn maybe_bearer_headers(config: &AiConfig) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if !config.api_key.trim().is_empty() {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", config.api_key)).map_err(|e| e.to_string())?,
        );
    }
    Ok(headers)
}

fn claude_headers(config: &AiConfig) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert("x-api-key", HeaderValue::from_str(&config.api_key).map_err(|e| e.to_string())?);
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
    Ok(headers)
}

pub fn build_ai_http_client(config: &AiConfig, timeout_secs: u64) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(timeout_secs));
    if config.proxy_enabled && !config.proxy_url.trim().is_empty() {
        let proxy = reqwest::Proxy::all(config.proxy_url.trim()).map_err(|e| format!("Invalid AI proxy URL: {e}"))?;
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Model listing
// ---------------------------------------------------------------------------

fn parse_model_list_response(data: &serde_json::Value) -> Result<Vec<AiModelInfo>, String> {
    let items = data["data"].as_array().ok_or_else(|| "Invalid model list response".to_string())?;
    let mut seen = HashSet::new();
    let mut models = Vec::new();

    for item in items {
        let Some(id) = item["id"].as_str().filter(|id| !id.trim().is_empty()) else {
            continue;
        };
        if !seen.insert(id.to_string()) {
            continue;
        }

        let display_name = item["display_name"]
            .as_str()
            .or_else(|| item["name"].as_str())
            .filter(|name| !name.trim().is_empty() && *name != id)
            .map(ToString::to_string);

        models.push(AiModelInfo { id: id.to_string(), display_name });
    }

    Ok(models)
}

async fn list_claude_models(client: &reqwest::Client, config: &AiConfig) -> Result<Vec<AiModelInfo>, String> {
    let res = client
        .get(resolve_model_list_endpoint(config)?)
        .headers(claude_headers(config)?)
        .send()
        .await
        .map_err(|e| format!("Claude model list request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("Claude model list API error: {status}")));
    }

    parse_model_list_response(&data)
}

async fn list_openai_compatible_models(
    client: &reqwest::Client,
    config: &AiConfig,
) -> Result<Vec<AiModelInfo>, String> {
    let res = client
        .get(resolve_model_list_endpoint(config)?)
        .headers(maybe_bearer_headers(config)?)
        .send()
        .await
        .map_err(|e| format!("AI model list request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("Model list API error: {status}")));
    }

    parse_model_list_response(&data)
}

pub async fn list_models_core(config: &AiConfig) -> Result<Vec<AiModelInfo>, String> {
    validate_model_list_config(config)?;

    let client = build_ai_http_client(config, 30)?;

    match config.provider {
        AiProvider::Claude => list_claude_models(&client, config).await,
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::Ollama
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => list_openai_compatible_models(&client, config).await,
        AiProvider::Gemini => {
            Err("Model listing is only supported for OpenAI-compatible and Claude providers".to_string())
        }
    }
}

// ---------------------------------------------------------------------------
// Non-streaming calls
// ---------------------------------------------------------------------------

pub async fn call_claude(client: &reqwest::Client, request: AiCompletionRequest) -> Result<String, String> {
    let body = json!({
        "model": request.config.model,
        "max_tokens": request.max_tokens.unwrap_or(2048),
        "temperature": request.temperature.unwrap_or(0.2),
        "system": request.system_prompt,
        "messages": request.messages,
    });

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(claude_headers(&request.config)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("Claude API error: {status}")));
    }

    Ok(data["content"]
        .as_array()
        .and_then(|items| items.iter().find_map(|item| item["text"].as_str()))
        .unwrap_or_default()
        .to_string())
}

pub async fn call_openai_compatible(client: &reqwest::Client, request: AiCompletionRequest) -> Result<String, String> {
    let headers = maybe_bearer_headers(&request.config)?;

    let mut messages = vec![json!({ "role": "system", "content": request.system_prompt })];
    messages.extend(request.messages.iter().map(|message| json!({ "role": message.role, "content": message.content })));

    let body_obj = build_openai_compatible_chat_body(
        &request.config,
        json!(messages),
        request.max_tokens,
        request.temperature,
        false,
    );

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(headers)
        .json(&body_obj)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("API error: {status}")));
    }

    Ok(data["choices"][0]["message"]["content"].as_str().unwrap_or_default().to_string())
}

pub async fn call_openai_raw_chat(
    client: &reqwest::Client,
    request: AiRawChatRequest,
) -> Result<AiRawChatResponse, String> {
    if request.config.api_style != AiApiStyle::Completions {
        return Err("AI tool calls currently require chat/completions API style".to_string());
    }
    if matches!(request.config.provider, AiProvider::Claude | AiProvider::Gemini) {
        return Err("AI tool calls currently require an OpenAI-compatible chat endpoint".to_string());
    }
    validate_config(&request.config)?;
    let headers = maybe_bearer_headers(&request.config)?;

    let mut messages = vec![json!({ "role": "system", "content": request.system_prompt })];
    messages.extend(request.messages.clone());

    let mut body_obj = build_openai_compatible_chat_body(
        &request.config,
        json!(messages),
        request.max_tokens,
        request.temperature,
        false,
    );
    if !request.tools.is_empty() {
        body_obj["tools"] = json!(request.tools.clone());
        body_obj["tool_choice"] = request.tool_choice.clone().unwrap_or_else(|| json!("auto"));
    }
    apply_raw_chat_request_options(&mut body_obj, &request);
    log_schema_doc_raw_chat_request(&request, &body_obj);

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(headers)
        .json(&body_obj)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        log_schema_doc_raw_chat_error(&request, &data);
        return Err(extract_error(&data).unwrap_or_else(|| format!("API error: {status}")));
    }

    let message = data["choices"].get(0).and_then(|choice| choice.get("message")).cloned().unwrap_or_default();
    log_schema_doc_raw_chat_response(&request, &message);
    let content = message["content"].as_str().unwrap_or_default().to_string();
    let tool_calls = message["tool_calls"]
        .as_array()
        .map(|calls| {
            calls
                .iter()
                .filter_map(|call| {
                    let function = &call["function"];
                    let name = function["name"].as_str()?.to_string();
                    Some(AiRawToolCall {
                        id: call["id"].as_str().unwrap_or_default().to_string(),
                        name,
                        arguments: function["arguments"].as_str().unwrap_or_default().to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(AiRawChatResponse { content, tool_calls, raw_message: message })
}

pub async fn call_responses_api(client: &reqwest::Client, request: AiCompletionRequest) -> Result<String, String> {
    let headers = maybe_bearer_headers(&request.config)?;

    let mut body = json!({
        "model": request.config.model,
        "input": build_responses_input(&request.system_prompt, &request.messages),
        "max_output_tokens": request.max_tokens.unwrap_or(2048),
        "temperature": request.temperature.unwrap_or(0.2),
    });
    add_responses_reasoning_options(&mut body, &request.config);

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("API error: {status}")));
    }

    Ok(data["output"]
        .as_array()
        .and_then(|items| {
            items.iter().find_map(|item| {
                item["content"].as_array().and_then(|parts| parts.iter().find_map(|p| p["text"].as_str()))
            })
        })
        .unwrap_or_default()
        .to_string())
}

pub async fn call_gemini(client: &reqwest::Client, request: AiCompletionRequest) -> Result<String, String> {
    let mut contents = Vec::new();
    for message in &request.messages {
        let role = if message.role == "assistant" { "model" } else { "user" };
        contents.push(json!({
            "role": role,
            "parts": [{ "text": message.content }],
        }));
    }

    let body = json!({
        "systemInstruction": {
            "parts": [{ "text": request.system_prompt }],
        },
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": request.max_tokens.unwrap_or(2048),
            "temperature": request.temperature.unwrap_or(0.2),
        },
    });

    let res = client
        .post(resolve_endpoint(&request.config))
        .query(&[("key", request.config.api_key.as_str())])
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("Gemini API error: {status}")));
    }

    Ok(gemini_text(&data))
}

// ---------------------------------------------------------------------------
// High-level: test_connection_core / complete
// ---------------------------------------------------------------------------

pub async fn test_connection_core(config: &AiConfig) -> Result<String, String> {
    validate_config(config)?;

    let client = build_ai_http_client(config, 15)?;

    let request = AiCompletionRequest {
        config: config.clone(),
        system_prompt: String::new(),
        messages: vec![AiMessage { role: "user".into(), content: "hi".into() }],
        max_tokens: Some(1),
        temperature: Some(0.0),
    };

    match request.config.provider {
        AiProvider::Claude => call_claude(&client, request).await,
        AiProvider::Gemini => call_gemini(&client, request).await,
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::Ollama
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => {
            if request.config.api_style == AiApiStyle::Responses {
                call_responses_api(&client, request).await
            } else {
                call_openai_compatible(&client, request).await
            }
        }
    }
    .map(|_| "OK".to_string())
}

pub async fn complete(request: &AiCompletionRequest) -> Result<String, String> {
    validate_config(&request.config)?;

    let client = build_ai_http_client(&request.config, 60)?;

    match request.config.provider {
        AiProvider::Claude => call_claude(&client, request.clone()).await,
        AiProvider::Gemini => call_gemini(&client, request.clone()).await,
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::Ollama
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => {
            if request.config.api_style == AiApiStyle::Responses {
                call_responses_api(&client, request.clone()).await
            } else {
                call_openai_compatible(&client, request.clone()).await
            }
        }
    }
}

pub async fn raw_chat(request: &AiRawChatRequest) -> Result<AiRawChatResponse, String> {
    let client = build_ai_http_client(&request.config, 60)?;
    call_openai_raw_chat(&client, request.clone()).await
}

pub async fn raw_chat_stream(
    session_id: &str,
    request: &AiRawChatRequest,
    cancelled: &Notify,
    on_chunk: impl Fn(AiStreamChunk),
) -> Result<AiRawChatResponse, String> {
    if !matches!(request.config.provider, AiProvider::Deepseek) {
        return Err("AI raw chat streaming is currently enabled only for DeepSeek provider".to_string());
    }
    if request.config.api_style != AiApiStyle::Completions {
        return Err("AI tool calls currently require chat/completions API style".to_string());
    }
    if matches!(request.config.provider, AiProvider::Claude | AiProvider::Gemini) {
        return Err("AI tool calls currently require an OpenAI-compatible chat endpoint".to_string());
    }
    validate_config(&request.config)?;

    let stream_timeout = if request.config.enable_thinking { 600 } else { 120 };
    let client = build_ai_http_client(&request.config, stream_timeout)?;
    stream_openai_raw_chat(&client, session_id, request, cancelled, &on_chunk).await
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

pub async fn stream(
    session_id: &str,
    request: &AiCompletionRequest,
    cancelled: &Notify,
    on_chunk: impl Fn(AiStreamChunk),
) -> Result<(), String> {
    validate_config(&request.config)?;

    let stream_timeout = if request.config.enable_thinking { 600 } else { 120 };
    let client = build_ai_http_client(&request.config, stream_timeout)?;

    match request.config.provider {
        AiProvider::Claude => stream_claude(&client, session_id, request, cancelled, &on_chunk).await,
        AiProvider::Gemini => stream_gemini(&client, session_id, request, cancelled, &on_chunk).await,
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::Ollama
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => {
            if request.config.api_style == AiApiStyle::Responses {
                stream_responses_api(&client, session_id, request, cancelled, &on_chunk).await
            } else {
                stream_openai(&client, session_id, request, cancelled, &on_chunk).await
            }
        }
    }
}

async fn stream_claude(
    client: &reqwest::Client,
    session_id: &str,
    request: &AiCompletionRequest,
    cancelled: &Notify,
    on_chunk: &impl Fn(AiStreamChunk),
) -> Result<(), String> {
    let body = json!({
        "model": request.config.model,
        "max_tokens": request.max_tokens.unwrap_or(2048),
        "temperature": request.temperature.unwrap_or(0.2),
        "system": request.system_prompt,
        "messages": request.messages,
        "stream": true,
    });

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(claude_headers(&request.config)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude request failed: {e}"))?;

    if !res.status().is_success() {
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        return Err(extract_error(&data).unwrap_or_else(|| "Claude API error".to_string()));
    }

    let mut byte_stream = res.bytes_stream();
    let mut buf = String::new();

    loop {
        tokio::select! {
            chunk = byte_stream.next() => {
                let Some(chunk) = chunk else { break };
                let chunk = chunk.map_err(|e| e.to_string())?;
                buf.push_str(&String::from_utf8_lossy(&chunk));

                let mut finished = false;
                while let Some(pos) = buf.find('\n') {
                    let line = buf[..pos].to_string();
                    buf = buf[pos + 1..].to_string();

                    let Some(data) = stream_data_payload(&line) else { continue };
                    if data == "[DONE]" {
                        finished = true;
                        break;
                    }

                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(text) = claude_stream_text(&event) {
                            on_chunk(AiStreamChunk {
                                session_id: session_id.to_string(),
                                delta: text.to_string(),
                                reasoning_delta: None,
                                tool_call_delta: None,
                                done: false,
                            });
                        }
                    }
                }

                if finished { break; }
            }
            _ = cancelled.notified() => { break; }
        }
    }

    on_chunk(AiStreamChunk {
        session_id: session_id.to_string(),
        delta: String::new(),
        reasoning_delta: None,
        tool_call_delta: None,
        done: true,
    });

    Ok(())
}

async fn stream_openai(
    client: &reqwest::Client,
    session_id: &str,
    request: &AiCompletionRequest,
    cancelled: &Notify,
    on_chunk: &impl Fn(AiStreamChunk),
) -> Result<(), String> {
    let headers = maybe_bearer_headers(&request.config)?;

    let mut messages = vec![json!({ "role": "system", "content": request.system_prompt })];
    messages.extend(request.messages.iter().map(|m| json!({ "role": m.role, "content": m.content })));

    let body_obj = build_openai_compatible_chat_body(
        &request.config,
        json!(messages),
        request.max_tokens,
        request.temperature,
        true,
    );

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(headers)
        .json(&body_obj)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    if !res.status().is_success() {
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        return Err(extract_error(&data).unwrap_or_else(|| "API error".to_string()));
    }

    let mut byte_stream = res.bytes_stream();
    let mut buf = String::new();

    loop {
        tokio::select! {
            chunk = byte_stream.next() => {
                let Some(chunk) = chunk else { break };
                let chunk = chunk.map_err(|e| e.to_string())?;
                buf.push_str(&String::from_utf8_lossy(&chunk));

                let mut finished = false;
                while let Some(pos) = buf.find('\n') {
                    let line = buf[..pos].to_string();
                    buf = buf[pos + 1..].to_string();

                    let Some(data) = stream_data_payload(&line) else { continue };
                    if data == "[DONE]" {
                        finished = true;
                        break;
                    }

                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(reasoning) = openai_stream_reasoning(&event) {
                            on_chunk(AiStreamChunk {
                                session_id: session_id.to_string(),
                                delta: String::new(),
                                reasoning_delta: Some(reasoning.to_string()),
                                tool_call_delta: None,
                                done: false,
                            });
                        }
                        if let Some(text) = openai_stream_text(&event) {
                            on_chunk(AiStreamChunk {
                                session_id: session_id.to_string(),
                                delta: text.to_string(),
                                reasoning_delta: None,
                                tool_call_delta: None,
                                done: false,
                            });
                        }
                    }
                }

                if finished { break; }
            }
            _ = cancelled.notified() => { break; }
        }
    }

    on_chunk(AiStreamChunk {
        session_id: session_id.to_string(),
        delta: String::new(),
        reasoning_delta: None,
        tool_call_delta: None,
        done: true,
    });

    Ok(())
}

async fn stream_openai_raw_chat(
    client: &reqwest::Client,
    session_id: &str,
    request: &AiRawChatRequest,
    cancelled: &Notify,
    on_chunk: &impl Fn(AiStreamChunk),
) -> Result<AiRawChatResponse, String> {
    let headers = maybe_bearer_headers(&request.config)?;

    let mut messages = vec![json!({ "role": "system", "content": request.system_prompt })];
    messages.extend(request.messages.clone());

    let mut body_obj = build_openai_compatible_chat_body(
        &request.config,
        json!(messages),
        request.max_tokens,
        request.temperature,
        true,
    );
    if !request.tools.is_empty() {
        body_obj["tools"] = json!(request.tools);
        body_obj["tool_choice"] = request.tool_choice.clone().unwrap_or_else(|| json!("auto"));
    }
    apply_raw_chat_request_options(&mut body_obj, request);
    log_schema_doc_raw_chat_request(request, &body_obj);

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(headers)
        .json(&body_obj)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    if !res.status().is_success() {
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        log_schema_doc_raw_chat_error(request, &data);
        return Err(extract_error(&data).unwrap_or_else(|| "API error".to_string()));
    }

    let mut byte_stream = res.bytes_stream();
    let mut buf = String::new();
    let mut accumulator = OpenAiRawChatStreamAccumulator::default();

    loop {
        tokio::select! {
            chunk = byte_stream.next() => {
                let Some(chunk) = chunk else { break };
                let chunk = chunk.map_err(|e| e.to_string())?;
                buf.push_str(&String::from_utf8_lossy(&chunk));

                let mut finished = false;
                while let Some(pos) = buf.find('\n') {
                    let line = buf[..pos].to_string();
                    buf = buf[pos + 1..].to_string();

                    let Some(data) = stream_data_payload(&line) else { continue };
                    if data == "[DONE]" {
                        finished = true;
                        break;
                    }

                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(reasoning) = openai_stream_reasoning(&event) {
                            accumulator.push_reasoning(reasoning);
                            on_chunk(AiStreamChunk {
                                session_id: session_id.to_string(),
                                delta: String::new(),
                                reasoning_delta: Some(reasoning.to_string()),
                                tool_call_delta: None,
                                done: false,
                            });
                        }
                        if let Some(text) = openai_stream_text(&event) {
                            accumulator.push_content(text);
                            on_chunk(AiStreamChunk {
                                session_id: session_id.to_string(),
                                delta: text.to_string(),
                                reasoning_delta: None,
                                tool_call_delta: None,
                                done: false,
                            });
                        }
                        for delta in openai_stream_tool_call_deltas(&event) {
                            accumulator.push_tool_call_delta(&delta);
                            on_chunk(AiStreamChunk {
                                session_id: session_id.to_string(),
                                delta: String::new(),
                                reasoning_delta: None,
                                tool_call_delta: Some(delta),
                                done: false,
                            });
                        }
                    }
                }

                if finished { break; }
            }
            _ = cancelled.notified() => { break; }
        }
    }

    on_chunk(AiStreamChunk {
        session_id: session_id.to_string(),
        delta: String::new(),
        reasoning_delta: None,
        tool_call_delta: None,
        done: true,
    });

    let response = accumulator.finish();
    log_schema_doc_raw_chat_response(request, &response.raw_message);
    Ok(response)
}

async fn stream_responses_api(
    client: &reqwest::Client,
    session_id: &str,
    request: &AiCompletionRequest,
    cancelled: &Notify,
    on_chunk: &impl Fn(AiStreamChunk),
) -> Result<(), String> {
    let headers = maybe_bearer_headers(&request.config)?;

    let mut body = json!({
        "model": request.config.model,
        "input": build_responses_input(&request.system_prompt, &request.messages),
        "max_output_tokens": request.max_tokens.unwrap_or(2048),
        "temperature": request.temperature.unwrap_or(0.2),
        "stream": true,
    });
    add_responses_reasoning_options(&mut body, &request.config);

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    if !res.status().is_success() {
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        return Err(extract_error(&data).unwrap_or_else(|| "API error".to_string()));
    }

    let mut byte_stream = res.bytes_stream();
    let mut buf = String::new();

    loop {
        tokio::select! {
            chunk = byte_stream.next() => {
                let Some(chunk) = chunk else { break };
                let chunk = chunk.map_err(|e| e.to_string())?;
                buf.push_str(&String::from_utf8_lossy(&chunk));

                let mut finished = false;
                while let Some(pos) = buf.find('\n') {
                    let line = buf[..pos].to_string();
                    buf = buf[pos + 1..].to_string();

                    let Some(data) = stream_data_payload(&line) else { continue };
                    if data == "[DONE]" {
                        finished = true;
                        break;
                    }

                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(reasoning) = responses_stream_reasoning(&event) {
                            on_chunk(AiStreamChunk {
                                session_id: session_id.to_string(),
                                delta: String::new(),
                                reasoning_delta: Some(reasoning.to_string()),
        tool_call_delta: None,
                                done: false,
                            });
                        }
                        if let Some(text) = responses_stream_text(&event) {
                            on_chunk(AiStreamChunk {
                                session_id: session_id.to_string(),
                                delta: text.to_string(),
                                reasoning_delta: None,
        tool_call_delta: None,
                                done: false,
                            });
                        }
                    }
                }

                if finished { break; }
            }
            _ = cancelled.notified() => { break; }
        }
    }

    on_chunk(AiStreamChunk {
        session_id: session_id.to_string(),
        delta: String::new(),
        reasoning_delta: None,
        tool_call_delta: None,
        done: true,
    });

    Ok(())
}

async fn stream_gemini(
    client: &reqwest::Client,
    session_id: &str,
    request: &AiCompletionRequest,
    cancelled: &Notify,
    on_chunk: &impl Fn(AiStreamChunk),
) -> Result<(), String> {
    let mut contents = Vec::new();
    for message in &request.messages {
        let role = if message.role == "assistant" { "model" } else { "user" };
        contents.push(json!({
            "role": role,
            "parts": [{ "text": message.content }],
        }));
    }

    let body = json!({
        "systemInstruction": {
            "parts": [{ "text": request.system_prompt }],
        },
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": request.max_tokens.unwrap_or(2048),
            "temperature": request.temperature.unwrap_or(0.2),
        },
    });

    let res = client
        .post(resolve_gemini_stream_endpoint(&request.config))
        .query(&[("key", request.config.api_key.as_str()), ("alt", "sse")])
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {e}"))?;

    if !res.status().is_success() {
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        return Err(extract_error(&data).unwrap_or_else(|| "Gemini API error".to_string()));
    }

    let mut byte_stream = res.bytes_stream();
    let mut buf = String::new();

    loop {
        tokio::select! {
            chunk = byte_stream.next() => {
                let Some(chunk) = chunk else { break };
                let chunk = chunk.map_err(|e| e.to_string())?;
                buf.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(pos) = buf.find('\n') {
                    let line = buf[..pos].to_string();
                    buf = buf[pos + 1..].to_string();

                    let Some(data) = stream_data_payload(&line) else { continue };
                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                        let text = gemini_text(&event);
                        if !text.is_empty() {
                            on_chunk(AiStreamChunk {
                                session_id: session_id.to_string(),
                                delta: text,
                                reasoning_delta: None,
        tool_call_delta: None,
                                done: false,
                            });
                        }
                    }
                }
            }
            _ = cancelled.notified() => { break; }
        }
    }

    on_chunk(AiStreamChunk {
        session_id: session_id.to_string(),
        delta: String::new(),
        reasoning_delta: None,
        tool_call_delta: None,
        done: true,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Conversation persistence (path-based)
// ---------------------------------------------------------------------------

const MAX_CONVERSATIONS: usize = 50;

pub fn read_conversations(path: &Path) -> Result<Vec<AiConversation>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

pub fn write_conversations(path: &Path, conversations: &[AiConversation]) -> Result<(), String> {
    let json = serde_json::to_string(conversations).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

pub fn save_conversation(path: &Path, conversation: AiConversation) -> Result<(), String> {
    let mut conversations = read_conversations(path)?;
    if let Some(pos) = conversations.iter().position(|c| c.id == conversation.id) {
        conversations[pos] = conversation;
    } else {
        conversations.insert(0, conversation);
        conversations.truncate(MAX_CONVERSATIONS);
    }
    write_conversations(path, &conversations)
}

pub fn load_conversations(path: &Path) -> Result<Vec<AiConversation>, String> {
    read_conversations(path)
}

pub fn delete_conversation(path: &Path, id: &str) -> Result<(), String> {
    let conversations: Vec<AiConversation> = read_conversations(path)?.into_iter().filter(|c| c.id != id).collect();
    write_conversations(path, &conversations)
}

pub fn save_config(path: &Path, config: &AiConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

pub fn load_config(path: &Path) -> Result<Option<AiConfig>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map(Some).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_raw_chat_request_options, build_ai_http_client, build_openai_compatible_chat_body, gemini_text,
        openai_stream_tool_call_deltas, parse_model_list_response, raw_chat_debug_label, resolve_endpoint,
        resolve_model_list_endpoint, responses_stream_reasoning, responses_stream_text,
        should_request_responses_reasoning_summary, validate_config, AiApiStyle, AiConfig, AiModelInfo, AiProvider,
        AiRawChatRequest, OpenAiRawChatStreamAccumulator,
    };

    #[test]
    fn ai_config_proxy_fields_default_for_legacy_config() {
        let config: AiConfig = serde_json::from_value(serde_json::json!({
            "provider": "openai",
            "apiKey": "key",
            "endpoint": "https://api.openai.com/v1/chat/completions",
            "model": "gpt-4o",
            "apiStyle": "completions"
        }))
        .unwrap();

        assert_eq!(config.proxy_enabled, false);
        assert_eq!(config.proxy_url, "");
        assert_eq!(config.enable_thinking, true);
        assert_eq!(config.schema_research.enabled, true);
        assert_eq!(config.schema_research.use_main_model, true);
        assert_eq!(config.schema_research.max_tool_rounds, 4);
        assert_eq!(config.schema_research.max_output_tokens, 1800);
    }

    #[test]
    fn ai_http_client_rejects_invalid_proxy_url() {
        let config = AiConfig {
            provider: AiProvider::Openai,
            api_key: "key".to_string(),
            endpoint: "https://api.openai.com/v1/chat/completions".to_string(),
            model: "gpt-4o".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: true,
            proxy_url: "not a proxy url".to_string(),
            enable_thinking: true,
            schema_research: Default::default(),
        };

        let err = build_ai_http_client(&config, 1).unwrap_err();

        assert!(err.contains("Invalid AI proxy URL"));
    }

    #[test]
    fn resolves_gemini_and_ollama_endpoints() {
        let gemini = AiConfig {
            provider: AiProvider::Gemini,
            api_key: "key".to_string(),
            endpoint: "https://generativelanguage.googleapis.com".to_string(),
            model: "gemini-1.5-pro".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
            schema_research: Default::default(),
        };

        assert_eq!(
            resolve_endpoint(&gemini),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent"
        );

        let ollama = AiConfig {
            provider: AiProvider::Ollama,
            api_key: String::new(),
            endpoint: "http://localhost:11434/v1".to_string(),
            model: "llama3.1".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
            schema_research: Default::default(),
        };

        assert_eq!(resolve_endpoint(&ollama), "http://localhost:11434/v1/chat/completions");
        assert!(validate_config(&ollama).is_ok());
    }

    #[test]
    fn resolves_model_list_endpoints_from_base_and_completion_urls() {
        let openai = AiConfig {
            provider: AiProvider::Openai,
            api_key: "key".to_string(),
            endpoint: "https://api.openai.com/v1/chat/completions".to_string(),
            model: String::new(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
            schema_research: Default::default(),
        };
        assert_eq!(resolve_model_list_endpoint(&openai).unwrap(), "https://api.openai.com/v1/models");

        let claude = AiConfig {
            provider: AiProvider::Claude,
            api_key: "key".to_string(),
            endpoint: "https://api.anthropic.com/v1/messages".to_string(),
            model: String::new(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
            schema_research: Default::default(),
        };
        assert_eq!(resolve_model_list_endpoint(&claude).unwrap(), "https://api.anthropic.com/v1/models");
    }

    #[test]
    fn parses_openai_and_claude_model_list_items() {
        let data = serde_json::json!({
            "data": [
                { "id": "gpt-4o-mini" },
                { "id": "claude-sonnet-4-20250514", "display_name": "Claude Sonnet 4" },
                { "id": "gpt-4o-mini" },
                { "display_name": "Missing ID" }
            ]
        });

        assert_eq!(
            parse_model_list_response(&data).unwrap(),
            vec![
                AiModelInfo { id: "gpt-4o-mini".to_string(), display_name: None },
                AiModelInfo {
                    id: "claude-sonnet-4-20250514".to_string(),
                    display_name: Some("Claude Sonnet 4".to_string())
                },
            ]
        );
    }

    #[test]
    fn parses_gemini_text_and_provider_aliases() {
        let data = serde_json::json!({
            "candidates": [{
                "content": {
                    "parts": [
                        { "text": "SELECT " },
                        { "text": "1;" }
                    ]
                }
            }]
        });

        assert_eq!(gemini_text(&data), "SELECT 1;");

        let claude: AiConfig = serde_json::from_value(serde_json::json!({
            "provider": "anthropic",
            "apiKey": "key",
            "endpoint": "https://api.anthropic.com/v1/messages",
            "model": "claude-sonnet-4-20250514"
        }))
        .unwrap();

        assert!(matches!(claude.provider, AiProvider::Claude));
    }

    #[test]
    fn parses_responses_text_and_reasoning_deltas_separately() {
        let text = serde_json::json!({
            "type": "response.output_text.delta",
            "delta": "SELECT 1;"
        });
        let reasoning = serde_json::json!({
            "type": "response.reasoning_summary_text.delta",
            "delta": "Checking table context"
        });

        assert_eq!(responses_stream_text(&text), Some("SELECT 1;"));
        assert_eq!(responses_stream_text(&reasoning), None);
        assert_eq!(responses_stream_reasoning(&reasoning), Some("Checking table context"));
    }

    #[test]
    fn requests_reasoning_summary_for_responses_reasoning_models_only_when_enabled() {
        let mut config = AiConfig {
            provider: AiProvider::Openai,
            api_key: "key".to_string(),
            endpoint: "https://api.openai.com/v1/responses".to_string(),
            model: "gpt-5.1".to_string(),
            api_style: AiApiStyle::Responses,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
            schema_research: Default::default(),
        };

        assert!(should_request_responses_reasoning_summary(&config));

        config.enable_thinking = false;
        assert!(!should_request_responses_reasoning_summary(&config));

        config.enable_thinking = true;
        config.model = "gpt-4o-mini".to_string();
        assert!(!should_request_responses_reasoning_summary(&config));
    }

    #[test]
    fn deepseek_thinking_payload_is_provider_scoped() {
        let deepseek = AiConfig {
            provider: AiProvider::Deepseek,
            api_key: "key".to_string(),
            endpoint: "https://api.deepseek.com/v1".to_string(),
            model: "deepseek-v4-pro".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
            schema_research: Default::default(),
        };
        let body = build_openai_compatible_chat_body(
            &deepseek,
            serde_json::json!([{ "role": "user", "content": "hi" }]),
            Some(16),
            Some(0.2),
            true,
        );

        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["reasoning_effort"], "high");
        assert!(body.get("temperature").is_none());
        assert_eq!(body["stream"], true);

        let qwen = AiConfig {
            provider: AiProvider::Qwen,
            api_key: "key".to_string(),
            endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
            model: "qwen-plus".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
            schema_research: Default::default(),
        };
        let body = build_openai_compatible_chat_body(
            &qwen,
            serde_json::json!([{ "role": "user", "content": "hi" }]),
            None,
            Some(0.15),
            false,
        );

        assert_eq!(body["temperature"], 0.15);
        assert!(body.get("thinking").is_none());
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn raw_chat_response_format_is_deepseek_scoped() {
        let request = AiRawChatRequest {
            config: AiConfig {
                provider: AiProvider::Deepseek,
                api_key: "key".to_string(),
                endpoint: "https://api.deepseek.com/v1".to_string(),
                model: "deepseek-chat".to_string(),
                api_style: AiApiStyle::Completions,
                proxy_enabled: false,
                proxy_url: String::new(),
                enable_thinking: true,
                schema_research: Default::default(),
            },
            system_prompt: "Output JSON only.".to_string(),
            messages: vec![serde_json::json!({ "role": "user", "content": "extract schema facts" })],
            tools: vec![],
            tool_choice: Some(serde_json::json!("none")),
            max_tokens: Some(1024),
            temperature: Some(0.0),
            response_format: Some(serde_json::json!({ "type": "json_object" })),
            debug_label: Some("schema-doc-extraction".to_string()),
        };
        let mut body = build_openai_compatible_chat_body(
            &request.config,
            serde_json::json!([{ "role": "system", "content": request.system_prompt.clone() }]),
            request.max_tokens,
            request.temperature,
            false,
        );
        apply_raw_chat_request_options(&mut body, &request);

        assert_eq!(body["response_format"]["type"], "json_object");
        assert_eq!(raw_chat_debug_label(&request), Some("schema-doc-extraction"));

        let mut openai_request = request.clone();
        openai_request.config.provider = AiProvider::Openai;
        let mut openai_body = build_openai_compatible_chat_body(
            &openai_request.config,
            serde_json::json!([{ "role": "user", "content": "extract schema facts" }]),
            openai_request.max_tokens,
            openai_request.temperature,
            false,
        );
        apply_raw_chat_request_options(&mut openai_body, &openai_request);

        assert!(openai_body.get("response_format").is_none());
        openai_request.debug_label = Some("ordinary-chat".to_string());
        assert_eq!(raw_chat_debug_label(&openai_request), None);
    }

    #[test]
    fn qwen_disable_thinking_keeps_existing_extra_body_shape() {
        let qwen = AiConfig {
            provider: AiProvider::Qwen,
            api_key: "key".to_string(),
            endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
            model: "qwen-plus".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: false,
            schema_research: Default::default(),
        };
        let body = build_openai_compatible_chat_body(
            &qwen,
            serde_json::json!([{ "role": "user", "content": "hi" }]),
            None,
            None,
            false,
        );

        assert_eq!(body["temperature"], 0.2);
        assert_eq!(body["extra_body"]["chat_template_kwargs"]["enable_thinking"], false);
        assert!(body.get("thinking").is_none());
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn aggregates_streamed_tool_call_and_reasoning_into_raw_message() {
        let reasoning = serde_json::json!({
            "choices": [{ "delta": { "reasoning_content": "need schema" } }]
        });
        let call_start = serde_json::json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "dbx_search_schema",
                            "arguments": "{\"query\":"
                        }
                    }]
                }
            }]
        });
        let call_end = serde_json::json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "function": { "arguments": "\"review\"}" }
                    }]
                }
            }]
        });

        let mut accumulator = OpenAiRawChatStreamAccumulator::default();
        accumulator.push_reasoning(super::openai_stream_reasoning(&reasoning).unwrap());
        for delta in openai_stream_tool_call_deltas(&call_start) {
            accumulator.push_tool_call_delta(&delta);
        }
        for delta in openai_stream_tool_call_deltas(&call_end) {
            accumulator.push_tool_call_delta(&delta);
        }
        let response = accumulator.finish();

        assert_eq!(response.content, "");
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].id, "call_1");
        assert_eq!(response.tool_calls[0].name, "dbx_search_schema");
        assert_eq!(response.tool_calls[0].arguments, "{\"query\":\"review\"}");
        assert_eq!(response.raw_message["reasoning_content"], "need schema");
        assert_eq!(response.raw_message["tool_calls"][0]["function"]["arguments"], "{\"query\":\"review\"}");
    }
}
