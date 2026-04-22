use chrono::Local;
use futures_util::{stream, StreamExt};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    panic::Location,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use zip::write::SimpleFileOptions;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TranscriptSegment {
    id: String,
    speaker: String,
    text: String,
    start_time: u32,
    end_time: u32,
    keywords: Option<Vec<String>>,
    is_partial: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskMetaItem {
    label: String,
    value: String,
    tone: Option<String>,
}



#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioFileItem {
    id: String,
    role: String,
    title: String,
    file_name: String,
    display_name: Option<String>,
    duration: String,
    duration_seconds: Option<u32>,
    start_time: Option<u32>,
    end_time: Option<u32>,
    file_path: Option<String>,
    text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusCheckItem {
    label: String,
    status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SelectOption {
    label: String,
    value: String,
    badge: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LlmEndpointConfig {
    id: String,
    title: String,
    provider: String,
    api_key: String,
    base_url: String,
    model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TtsEndpointConfig {
    id: String,
    title: String,
    provider: String,
    api_key: String,
    base_url: String,
    tts_model: String,
    sales_voice: String,
    customer_voice: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PromptTemplate {
    id: String,
    title: String,
    description: String,
    system_prompt: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    #[serde(default)]
    active_llm_id: String,
    #[serde(default)]
    llm_endpoints: Vec<LlmEndpointConfig>,

    #[serde(default)]
    active_tts_id: String,
    #[serde(default)]
    tts_endpoints: Vec<TtsEndpointConfig>,

    #[serde(default)]
    active_prompt_id: String,

    #[serde(default)]
    audio_dir: String,
    #[serde(default)]
    database_path: String,
    #[serde(default)]
    config_file: String,

    #[serde(default)]
    llm_provider: String,
    #[serde(default)]
    llm_api_key: String,
    #[serde(default)]
    llm_base_url: String,
    #[serde(default)]
    llm_model: String,
    #[serde(default)]
    tts_provider: String,
    #[serde(default)]
    tts_api_key: String,
    #[serde(default)]
    tts_model: String,
    #[serde(default)]
    tts_base_url: String,
    #[serde(default)]
    sales_voice: String,
    #[serde(default)]
    customer_voice: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceData {
    config: AppConfig,
    #[serde(default)]
    prompts: Vec<PromptTemplate>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateConversationInput {
    scenario: String,
    rounds: u32,
    supplemental_prompt: Option<String>,
    llm_endpoint_id: Option<String>,
    system_prompt: Option<String>,
    request_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrontendLogInput {
    level: String,
    scope: String,
    message: String,
    payload: Option<String>,
    location: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateConversationOutput {
    transcript: Vec<TranscriptSegment>,
    task_info: Vec<TaskMetaItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateAudioInput {
    transcript: Vec<TranscriptSegment>,
    sales_voice: String,
    customer_voice: String,
    audio_dir: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateAudioOutput {
    task: AudioGenerationTaskItem,
    audio_files: Vec<AudioFileItem>,
    merged_file: Option<AudioFileItem>,
}

const AUDIO_TASK_STATUS_PENDING: &str = "pending";
const AUDIO_TASK_STATUS_PROCESSING: &str = "processing";
const AUDIO_TASK_STATUS_PARTIAL_FAILED: &str = "partial_failed";
const AUDIO_TASK_STATUS_COMPLETED: &str = "completed";

const AUDIO_SEGMENT_STATUS_PENDING: &str = "pending";
const AUDIO_SEGMENT_STATUS_PROCESSING: &str = "processing";
const AUDIO_SEGMENT_STATUS_SUCCEEDED: &str = "succeeded";
const AUDIO_SEGMENT_STATUS_FAILED: &str = "failed";

const AUDIO_TTS_CONCURRENCY: usize = 3;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioGenerationSegmentItem {
    id: String,
    segment_index: u32,
    speaker: String,
    text: String,
    status: String,
    file_name: Option<String>,
    file_path: Option<String>,
    error_message: Option<String>,
    attempt_count: u32,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioGenerationTaskItem {
    id: String,
    batch_id: String,
    status: String,
    audio_dir: String,
    tts_endpoint_id: String,
    total_segments: u32,
    success_segments: u32,
    failed_segments: u32,
    merged_audio_record_id: Option<String>,
    last_error: Option<String>,
    created_at: String,
    updated_at: String,
    segments: Vec<AudioGenerationSegmentItem>,
}

#[derive(Debug, Clone)]
struct AudioGenerationTaskState {
    id: String,
    batch_id: String,
    status: String,
    audio_dir: String,
    tts_endpoint_id: String,
    transcript: Vec<TranscriptSegment>,
    total_segments: u32,
    success_segments: u32,
    failed_segments: u32,
    merged_audio_record_id: Option<String>,
    last_error: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone)]
struct AudioGenerationJob {
    segment_id: String,
    segment_index: u32,
    speaker: String,
    text: String,
    file_name: String,
    file_path: PathBuf,
    attempt_count: u32,
}

#[derive(Debug)]
struct AudioGenerationTaskSummary {
    total_segments: u32,
    success_segments: u32,
    failed_segments: u32,
}

#[derive(Debug)]
struct AudioGenerationProcessResult {
    task: AudioGenerationTaskItem,
    merged_file: Option<AudioFileItem>,
}

#[derive(Debug)]
struct AudioGenerationJobResult {
    job: AudioGenerationJob,
    bytes: Option<Vec<u8>>,
    error_message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthStatus {
    system: Vec<StatusCheckItem>,
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmTranscriptRow {
    #[serde(default)]
    role: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    speaker: String,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    temperature: f32,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct AnthropicTextBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: String,
}

#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: String,
    content: Vec<AnthropicTextBlock>,
}

#[derive(Debug, Serialize)]
struct AnthropicMessagesRequest {
    model: String,
    system: String,
    messages: Vec<AnthropicMessage>,
    temperature: f32,
    max_tokens: u32,
    stream: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConversationStartedEvent {
    request_id: String,
    rounds: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConversationDeltaEvent {
    request_id: String,
    segment: TranscriptSegment,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConversationStreamDeltaEvent {
    request_id: String,
    text_delta: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConversationCompletedEvent {
    request_id: String,
    transcript: Vec<TranscriptSegment>,
    task_info: Vec<TaskMetaItem>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConversationFailedEvent {
    request_id: String,
    message: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamResponse {
    choices: Vec<OpenAiStreamChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamChoice {
    #[serde(default)]
    delta: Option<OpenAiStreamDelta>,
    #[serde(default)]
    message: Option<OpenAiStreamDelta>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamDelta {
    #[serde(default)]
    content: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamEvent {
    #[serde(default, rename = "type")]
    event_type: String,
    #[serde(default)]
    delta: Option<AnthropicStreamDelta>,
    #[serde(default)]
    error: Option<AnthropicErrorPayload>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamDelta {
    #[serde(default, rename = "type")]
    delta_type: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicErrorPayload {
    #[serde(default)]
    message: String,
}

#[derive(Debug)]
struct SseFrame {
    event: Option<String>,
    data: String,
}

#[derive(Debug)]
enum ParsedSseEvent {
    TextDelta(String),
    Error(String),
    Ignore,
}

#[derive(Debug, Clone, Copy)]
enum LlmStreamProtocol {
    OpenAiCompatible,
    AnthropicMessages,
}

impl LlmStreamProtocol {
    fn from_provider(provider: &str) -> Self {
        match provider.trim().to_ascii_lowercase().as_str() {
            "anthropic" => Self::AnthropicMessages,
            "openai" | "azure" | "google" | "qwen" => Self::OpenAiCompatible,
            _ => Self::OpenAiCompatible,
        }
    }
}

#[derive(Debug)]
struct LlmStreamResult {
    accumulated_content: String,
    streamed_segment_count: usize,
    unmatched_frame_preview: Option<String>,
}

#[derive(Debug)]
struct LlmRequestContext<'a> {
    app: &'a AppHandle,
    request_id: &'a str,
}

#[derive(Debug)]
struct LlmRequestPayload {
    url: String,
    headers: Vec<(&'static str, String)>,
    body: serde_json::Value,
    protocol: LlmStreamProtocol,
}

#[derive(Debug)]
struct StreamFrameIssue {
    preview: String,
    error_message: Option<String>,
}

impl StreamFrameIssue {
    fn from_error(preview: String, error_message: String) -> Self {
        Self {
            preview,
            error_message: Some(error_message),
        }
    }
}

impl StreamFrameIssue {
    fn into_preview(self) -> String {
        match self.error_message {
            Some(error_message) => format!("parse_error={} raw={}", error_message, self.preview),
            None => self.preview,
        }
    }
}

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_LLM_TEMPERATURE: f32 = 0.7;
const DEFAULT_ANTHROPIC_MAX_TOKENS: u32 = 4096;
const OPENAI_STREAM_DONE_SENTINEL: &str = "[DONE]";
const SSE_FRAME_SEPARATOR: &str = "\n\n";
const FRAME_PREVIEW_LIMIT: usize = 240;
const LOG_PAYLOAD_CHUNK_SIZE: usize = 2000;
const LOG_PAYLOAD_CHUNK_THRESHOLD: usize = 2400;
const TRANSCRIPT_SEGMENT_MIN_SECONDS: u32 = 2;
const TRANSCRIPT_SEGMENT_MAX_SECONDS: u32 = 12;
const TRANSCRIPT_CHARS_PER_SECOND: u32 = 6;
const TRANSCRIPT_SEGMENT_GAP_SECONDS: u32 = 1;

fn estimate_transcript_segment_seconds(text: &str) -> u32 {
    let char_count = text.chars().count() as u32;
    let estimated = char_count.div_ceil(TRANSCRIPT_CHARS_PER_SECOND);
    estimated
        .max(TRANSCRIPT_SEGMENT_MIN_SECONDS)
        .min(TRANSCRIPT_SEGMENT_MAX_SECONDS)
}

fn build_transcript_timing(texts: &[String]) -> Vec<(u32, u32)> {
    let mut current_start = 0u32;
    texts
        .iter()
        .map(|text| {
            let duration = estimate_transcript_segment_seconds(text);
            let start_time = current_start;
            let end_time = start_time + duration;
            current_start = end_time + TRANSCRIPT_SEGMENT_GAP_SECONDS;
            (start_time, end_time)
        })
        .collect()
}

fn transcript_row_text(row: &LlmTranscriptRow) -> String {
    if !row.text.trim().is_empty() {
        row.text.trim().to_string()
    } else {
        row.content.trim().to_string()
    }
}

fn transcript_row_speaker(row: &LlmTranscriptRow) -> String {
    if !row.speaker.trim().is_empty() {
        normalize_llm_speaker(&row.speaker)
    } else {
        normalize_llm_speaker(&row.role)
    }
}

fn validate_transcript_row(idx: usize, speaker: &str, text: &str) -> Result<(), String> {
    if speaker != "sales" && speaker != "customer" {
        return Err(format!("第 {} 条对话缺少合法 speaker/role 字段", idx + 1));
    }
    if text.is_empty() {
        return Err(format!("第 {} 条对话缺少 text/content 字段", idx + 1));
    }
    Ok(())
}

fn split_log_chunks(value: &str, chunk_size: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_len = 0usize;

    for ch in value.chars() {
        current.push(ch);
        current_len += 1;
        if current_len >= chunk_size {
            chunks.push(std::mem::take(&mut current));
            current_len = 0;
        }
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    if chunks.is_empty() {
        chunks.push(String::new());
    }

    chunks
}

fn write_backend_log_line(
    app: &AppHandle,
    level: &str,
    scope: &str,
    location: &str,
    message: &str,
    payload: Option<&str>,
) {
    let parse_level = |v: &str| -> u8 {
        match v {
            "debug" => 0,
            "info" => 1,
            "warn" => 2,
            "error" => 3,
            _ => 3,
        }
    };
    let default_level = if cfg!(debug_assertions) {
        parse_level("debug")
    } else {
        parse_level("info")
    };
    let min_level = std::env::var("SALES_AUDIO_AI_LOG_LEVEL")
        .ok()
        .map(|v| parse_level(v.trim()))
        .or_else(|| {
            if std::env::var("SALES_AUDIO_AI_DEBUG").map(|v| v == "1").unwrap_or(false) {
                Some(parse_level("debug"))
            } else {
                None
            }
        })
        .unwrap_or(default_level);
    if parse_level(level) < min_level {
        return;
    }
    let payload_suffix = payload
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" | {}", value))
        .unwrap_or_default();
    let console_line = format!(
        "[sales-audio-ai][{}][{}][{}][{}] {}{}",
        format_log_timestamp(),
        level,
        scope,
        location,
        message,
        payload_suffix
    );
    match level {
        "error" => eprintln!("{}", console_line),
        "warn" => eprintln!("{}", console_line),
        _ => println!("{}", console_line),
    }

    if let Err(error) = append_local_log(app, level, scope, Some(location), message, payload) {
        eprintln!(
            "[sales-audio-ai][{}][error][backend:logger][desktop/src-tauri/src/lib.rs] 写入本地日志失败 | {}",
            format_log_timestamp(),
            error
        );
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenAiSpeechRequest {
    model: String,
    input: String,
    voice: String,
    response_format: String,
}

async fn request_openai_tts_bytes(tts_config: &TtsEndpointConfig, text: &str, voice: &str) -> Result<Vec<u8>, String> {
    let api_key = tts_config.api_key.trim();
    if api_key.is_empty() {
        return Err("未配置 TTS API Key".into());
    }

    let base_url = tts_config.base_url.trim_end_matches('/');
    let url = format!("{}/audio/speech", base_url);
    let request = OpenAiSpeechRequest {
        model: if tts_config.tts_model.trim().is_empty() {
            "gpt-4o-mini-tts".into()
        } else {
            tts_config.tts_model.clone()
        },
        input: text.to_string(),
        voice: voice.to_string(),
        response_format: "mp3".into(),
    };

    let response = reqwest::Client::new()
        .post(url)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(CONTENT_TYPE, "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("请求 OpenAI TTS 失败: {e}"))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI TTS 返回失败: {}", text));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| format!("读取 OpenAI TTS 音频失败: {e}"))
}

async fn request_elevenlabs_tts_bytes(tts_config: &TtsEndpointConfig, text: &str, voice: &str) -> Result<Vec<u8>, String> {
    let api_key = tts_config.api_key.trim();
    if api_key.is_empty() {
        return Err("未配置 TTS API Key".into());
    }

    let base_url = tts_config.base_url.trim_end_matches('/');
    let base_url = if base_url.is_empty() {
        "https://api.elevenlabs.io/v1"
    } else {
        base_url
    };
    let voice_id = if voice.trim().is_empty() {
        "EXAVITQu4vr4xnSDxMaL"
    } else {
        voice
    };
    let url = format!("{}/text-to-speech/{}", base_url, voice_id);

    let response = reqwest::Client::new()
        .post(url)
        .header("xi-api-key", api_key)
        .header(CONTENT_TYPE, "application/json")
        .query(&[("output_format", "mp3_44100_128")])
        .json(&serde_json::json!({
            "text": text,
            "model_id": if tts_config.tts_model.trim().is_empty() { "eleven_multilingual_v2" } else { tts_config.tts_model.as_str() }
        }))
        .send()
        .await
        .map_err(|e| format!("请求 ElevenLabs TTS 失败: {e}"))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("ElevenLabs TTS 返回失败: {}", text));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| format!("读取 ElevenLabs 音频失败: {e}"))
}

async fn request_qwen_tts_bytes(tts_config: &TtsEndpointConfig, text: &str, voice: &str) -> Result<Vec<u8>, String> {
    let base_url = tts_config.base_url.trim_end_matches('/');
    if base_url.is_empty() {
        return Err("未配置千问 TTS Base URL".into());
    }

    let selected_voice = voice.trim();
    if selected_voice.is_empty() {
        return Err("未选择千问 TTS 音色".into());
    }

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/tts", base_url))
        .header(CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({
            "text": text,
            "voice": selected_voice,
            "language": "Chinese / 中文"
        }))
        .send()
        .await
        .map_err(|e| format!("请求千问 TTS 失败: {e}"))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("千问 TTS 返回失败: {}", text));
    }

    let payload: QwenTtsResponse = response
        .json()
        .await
        .map_err(|e| format!("解析千问 TTS 响应失败: {e}"))?;

    let file_url = payload.file_url.trim();
    if file_url.is_empty() {
        return Err("千问 TTS 未返回 file_url".into());
    }

    let download_url = if file_url.starts_with("http://") || file_url.starts_with("https://") {
        file_url.to_string()
    } else {
        format!("{}{}", base_url, file_url)
    };

    let audio_response = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("下载千问 TTS 音频失败: {e}"))?;

    if !audio_response.status().is_success() {
        let text = audio_response.text().await.unwrap_or_default();
        return Err(format!("下载千问 TTS 音频失败: {}", text));
    }

    audio_response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| format!("读取千问 TTS 音频失败: {e}"))
}

async fn list_tts_voices_inner(app: &AppHandle, config: &AppConfig) -> Result<Vec<SelectOption>, String> {
    let tts_config = config
        .tts_endpoints
        .iter()
        .find(|e| e.id == config.active_tts_id)
        .or_else(|| config.tts_endpoints.first())
        .ok_or_else(|| "没有可用的 TTS 配置".to_string())?;

    if tts_config.provider != "qwen" {
        return Err("当前 TTS 提供商不支持获取音色列表".into());
    }

    let base_url = tts_config.base_url.trim_end_matches('/');
    if base_url.is_empty() {
        return Err("未配置千问 TTS Base URL".into());
    }

    write_backend_log(
        app,
        "info",
        "tts",
        "desktop/src-tauri/src/lib.rs::list_tts_voices_inner",
        "开始拉取音色列表",
        Some(format!("endpoint={} provider={}", tts_config.id, tts_config.provider)),
    );

    let response = reqwest::Client::new()
        .get(format!("{}/voices", base_url))
        .send()
        .await
        .map_err(|e| format!("请求音色列表失败: {e}"))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        write_backend_log(
            app,
            "error",
            "tts",
            "desktop/src-tauri/src/lib.rs::list_tts_voices_inner",
            "音色列表接口失败",
            Some(format!("endpoint={} body={}", tts_config.id, text)),
        );
        return Err(format!("音色列表接口返回失败: {}", text));
    }

    let payload: QwenVoicesResponse = response
        .json()
        .await
        .map_err(|e| format!("解析音色列表失败: {e}"))?;

    let mut voices = payload
        .voices
        .into_iter()
        .filter(|voice| !voice.trim().is_empty())
        .map(|voice| SelectOption {
            label: voice.clone(),
            value: voice,
            badge: None,
        })
        .collect::<Vec<_>>();

    voices.sort_by(|a, b| a.label.cmp(&b.label));
    write_backend_log(
        app,
        "info",
        "tts",
        "desktop/src-tauri/src/lib.rs::list_tts_voices_inner",
        "音色列表拉取成功",
        Some(format!("endpoint={} count={}", tts_config.id, voices.len())),
    );
    Ok(voices)
}

fn is_mp3_audio(bytes: &[u8]) -> bool {
    bytes.starts_with(b"ID3") || (bytes.len() >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0)
}

async fn synthesize_audio_bytes(app: &AppHandle, config: &AppConfig, tts_endpoint_id: &str, speaker: &str, text: &str) -> Result<Vec<u8>, String> {
    let tts_config = resolve_tts_endpoint(config, tts_endpoint_id)?;

    let voice = if speaker == "sales" {
        tts_config.sales_voice.as_str()
    } else {
        tts_config.customer_voice.as_str()
    };

    write_backend_log(
        app,
        "info",
        "tts",
        "desktop/src-tauri/src/lib.rs::synthesize_audio_bytes",
        "开始合成音频片段",
        Some(format!(
            "endpoint={} provider={} speaker={} text_len={}",
            tts_config.id,
            tts_config.provider,
            speaker,
            text.chars().count()
        )),
    );

    match tts_config.provider.as_str() {
        "openai" => request_openai_tts_bytes(tts_config, text, voice).await,
        "elevenlabs" => request_elevenlabs_tts_bytes(tts_config, text, voice).await,
        "qwen" => request_qwen_tts_bytes(tts_config, text, voice).await,
        _ => Err("当前 TTS 提供商未接入真实在线语音，已回退本地占位文件。".into()),
    }
}

fn decode_mp3_to_wav_samples(bytes: &[u8]) -> Result<(hound::WavSpec, Vec<i16>), String> {
    let mut decoder = minimp3::Decoder::new(std::io::Cursor::new(bytes));
    let mut samples = Vec::new();
    let mut spec: Option<hound::WavSpec> = None;

    loop {
        match decoder.next_frame() {
            Ok(frame) => {
                if spec.is_none() {
                    spec = Some(hound::WavSpec {
                        channels: frame.channels as u16,
                        sample_rate: frame.sample_rate as u32,
                        bits_per_sample: 16,
                        sample_format: hound::SampleFormat::Int,
                    });
                }
                samples.extend(frame.data);
            }
            Err(minimp3::Error::Eof) => break,
            Err(error) => return Err(format!("解码 MP3 失败: {error}")),
        }
    }

    let spec = spec.ok_or_else(|| "MP3 内容为空，无法合并".to_string())?;
    Ok((spec, samples))
}

fn decode_wav_to_samples(bytes: &[u8]) -> Result<(hound::WavSpec, Vec<i16>), String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut reader = hound::WavReader::new(cursor).map_err(|e| format!("解析 WAV 失败: {e}"))?;
    let spec = reader.spec();
    if spec.bits_per_sample != 16 || spec.sample_format != hound::SampleFormat::Int {
        return Err("当前仅支持 16-bit PCM WAV 合并".into());
    }

    let samples = reader
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取 WAV 采样失败: {e}"))?;
    Ok((spec, samples))
}

fn merge_audio_segments_to_wav(path: &Path, chunks: &[Vec<u8>]) -> Result<(), String> {
    if chunks.is_empty() {
        return Err("没有可合并的音频片段".into());
    }

    let mut merged_samples = Vec::new();
    let mut target_spec: Option<hound::WavSpec> = None;

    for chunk in chunks {
        let (spec, samples) = if is_mp3_audio(chunk) {
            decode_mp3_to_wav_samples(chunk)?
        } else {
            decode_wav_to_samples(chunk)?
        };
        if let Some(existing) = &target_spec {
            if existing.channels != spec.channels || existing.sample_rate != spec.sample_rate {
                return Err("音频片段采样率或声道数不一致，暂时无法合并".into());
            }
        } else {
            target_spec = Some(spec);
        }
        merged_samples.extend(samples);
    }

    let spec = target_spec.ok_or_else(|| "未找到可用音频规格".to_string())?;
    let mut writer = hound::WavWriter::create(path, spec).map_err(|e| format!("创建 WAV 合并文件失败: {e}"))?;
    for sample in merged_samples {
        writer
            .write_sample(sample)
            .map_err(|e| format!("写入 WAV 采样失败: {e}"))?;
    }
    writer.finalize().map_err(|e| format!("完成 WAV 文件失败: {e}"))?;
    Ok(())
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))
}

fn workspace_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("app.db"))
}

fn app_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("logs").join("app.log"))
}

fn initialize_app_storage(app: &AppHandle) -> Result<(), String> {
    let data_dir = app_data_dir(app)?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("创建应用数据目录失败: {e}"))?;

    let db_path = workspace_db_path(app)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建数据库目录失败: {e}"))?;
    }

    let _ = open_workspace_db(app)?;

    let log_path = app_log_path(app)?;
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建日志目录失败: {e}"))?;
    }

    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("初始化日志文件失败: {e}"))?;

    let _ = ensure_workspace(app)?;

    Ok(())
}

fn format_log_timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string()
}

fn normalize_log_location(scope: &str, location: Option<&str>) -> String {
    let raw = location.map(str::trim).filter(|value| !value.is_empty()).unwrap_or("");
    if raw.is_empty() {
        if scope.starts_with("frontend:") {
            return "desktop/src".into();
        }
        return "desktop/src-tauri/src/lib.rs".into();
    }

    if let Some(path_start) = raw.find("desktop/src/") {
        return raw[path_start..].to_string();
    }

    if let Some(path_start) = raw.find("desktop/src-tauri/") {
        return raw[path_start..].to_string();
    }

    if raw.starts_with("frontend:") {
        return "desktop/src".into();
    }

    raw.to_string()
}

fn normalize_log_scope(scope: &str) -> String {
    if scope.starts_with("frontend:") || scope.starts_with("backend:") {
        return scope.to_string();
    }

    format!("backend:{}", scope)
}

fn append_local_log(
    app: &AppHandle,
    level: &str,
    scope: &str,
    location: Option<&str>,
    message: &str,
    payload: Option<&str>,
) -> Result<(), String> {
    let log_path = app_log_path(app)?;
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建日志目录失败: {e}"))?;
    }

    let normalized_scope = normalize_log_scope(scope);
    let normalized_location = normalize_log_location(&normalized_scope, location);
    let payload_suffix = payload
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" | {}", value))
        .unwrap_or_default();
    let line = format!(
        "[sales-audio-ai][{}][{}][{}][{}] {}{}\n",
        format_log_timestamp(),
        level,
        normalized_scope,
        normalized_location,
        message,
        payload_suffix
    );

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("打开日志文件失败: {e}"))?;
    file.write_all(line.as_bytes())
        .map_err(|e| format!("写入日志文件失败: {e}"))?;
    Ok(())
}

fn backend_log_location(location: &'static Location<'static>) -> String {
    format!("desktop/{}:{}", location.file(), location.line())
}

#[track_caller]
fn write_backend_log(
    app: &AppHandle,
    level: &str,
    scope: &str,
    _location: &str,
    message: &str,
    payload: Option<String>,
) {
    let caller = Location::caller();
    let normalized_scope = normalize_log_scope(scope);
    let normalized_location = normalize_log_location(&normalized_scope, Some(&backend_log_location(caller)));
    let payload = payload
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    match payload {
        Some(payload_text) if payload_text.chars().count() > LOG_PAYLOAD_CHUNK_THRESHOLD => {
            let chunks = split_log_chunks(&payload_text, LOG_PAYLOAD_CHUNK_SIZE);
            let total = chunks.len();
            for (index, chunk) in chunks.into_iter().enumerate() {
                let chunk_message = if index == 0 {
                    format!("{} [part {}/{}]", message, index + 1, total)
                } else {
                    format!("{} [cont {}/{}]", message, index + 1, total)
                };
                write_backend_log_line(
                    app,
                    level,
                    &normalized_scope,
                    &normalized_location,
                    &chunk_message,
                    Some(&chunk),
                );
            }
        }
        Some(payload_text) => {
            write_backend_log_line(
                app,
                level,
                &normalized_scope,
                &normalized_location,
                message,
                Some(&payload_text),
            );
        }
        None => {
            write_backend_log_line(
                app,
                level,
                &normalized_scope,
                &normalized_location,
                message,
                None,
            );
        }
    }
}

fn legacy_workspace_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("workspace.json"))
}

fn open_workspace_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = workspace_db_path(app)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    }

    let conn = Connection::open(&db_path).map_err(|e| format!("打开应用数据库失败: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )
    .map_err(|e| format!("初始化应用数据库失败: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS audio_records (
            id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            role TEXT NOT NULL,
            title TEXT NOT NULL,
            file_name TEXT NOT NULL,
            display_name TEXT,
            file_path TEXT NOT NULL,
            duration TEXT NOT NULL DEFAULT '',
            text TEXT,
            created_at TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("初始化音频记录表失败: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS audio_generation_tasks (
            id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            status TEXT NOT NULL,
            audio_dir TEXT NOT NULL,
            tts_endpoint_id TEXT NOT NULL,
            transcript_json TEXT NOT NULL,
            total_segments INTEGER NOT NULL DEFAULT 0,
            success_segments INTEGER NOT NULL DEFAULT 0,
            failed_segments INTEGER NOT NULL DEFAULT 0,
            merged_audio_record_id TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("初始化音频任务表失败: {e}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS audio_generation_segments (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            segment_index INTEGER NOT NULL,
            speaker TEXT NOT NULL,
            text TEXT NOT NULL,
            status TEXT NOT NULL,
            file_name TEXT,
            file_path TEXT,
            error_message TEXT,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(task_id, segment_index)
        )",
        [],
    )
    .map_err(|e| format!("初始化音频任务分段表失败: {e}"))?;
    conn.execute("ALTER TABLE audio_records ADD COLUMN display_name TEXT", [])
        .or_else(|err| {
            if matches!(err, rusqlite::Error::SqliteFailure(_, Some(ref message)) if message.contains("duplicate column name")) {
                Ok(0)
            } else {
                Err(err)
            }
        })
        .map_err(|e| format!("迁移音频记录表失败: {e}"))?;
    cleanup_legacy_storage(&conn).map_err(|e| format!("清理遗留表失败: {e}"))?;
    Ok(conn)
}

fn cleanup_legacy_storage(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS audio_files;
         DROP TABLE IF EXISTS dialog_scripts;
         DROP TABLE IF EXISTS dialog_tasks;
         DROP TABLE IF EXISTS app_config;",
    )
}

fn cleanup_legacy_files(app: &AppHandle) -> Result<Vec<String>, String> {
    let data_dir = app_data_dir(app)?;
    let mut removed = Vec::new();

    let direct_targets = [data_dir.join("workspace.json")];
    for path in direct_targets {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("删除遗留文件失败: {}: {e}", path.to_string_lossy()))?;
            removed.push(path.to_string_lossy().to_string());
        }
    }

    let entries = fs::read_dir(&data_dir).map_err(|e| format!("读取应用目录失败: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取应用目录条目失败: {e}"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let should_remove = name.starts_with("workspace.json.backup-") || name.starts_with("app.db.backup-");
        if should_remove {
            let path = entry.path();
            fs::remove_file(&path).map_err(|e| format!("删除遗留备份失败: {}: {e}", path.to_string_lossy()))?;
            removed.push(path.to_string_lossy().to_string());
        }
    }

    Ok(removed)
}

fn remove_legacy_files_with_log(app: &AppHandle, _location: &str) -> Result<(), String> {
    let removed = cleanup_legacy_files(app)?;
    if !removed.is_empty() {
        write_backend_log(
            app,
            "info",
            "workspace",
            "desktop/src-tauri/src/lib.rs::remove_legacy_files_with_log",
            "已清理遗留工作区文件",
            Some(format!("count={} files={}", removed.len(), removed.join(", "))),
        );
    }
    Ok(())
}

fn persist_audio_record(app: &AppHandle, batch_id: &str, audio: &AudioFileItem) -> Result<(), String> {
    let conn = open_workspace_db(app)?;
    conn.execute(
        "INSERT INTO audio_records(
            id, batch_id, role, title, file_name, display_name, file_path, duration, text, created_at
        ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            audio.id,
            batch_id,
            audio.role,
            audio.title,
            audio.file_name,
            audio.display_name,
            audio.file_path.clone().unwrap_or_default(),
            audio.duration,
            audio.text,
            now_text(),
        ],
    )
    .map_err(|e| format!("写入音频记录失败: {e}"))?;
    Ok(())
}

fn resolve_tts_endpoint<'a>(config: &'a AppConfig, tts_endpoint_id: &str) -> Result<&'a TtsEndpointConfig, String> {
    let target_id = if tts_endpoint_id.trim().is_empty() {
        config.active_tts_id.as_str()
    } else {
        tts_endpoint_id.trim()
    };

    config
        .tts_endpoints
        .iter()
        .find(|endpoint| endpoint.id == target_id)
        .or_else(|| config.tts_endpoints.first())
        .ok_or_else(|| "没有可用的 TTS 配置".to_string())
}

fn load_audio_record_by_id_from_conn(conn: &Connection, id: &str) -> Result<Option<AudioFileItem>, String> {
    conn.query_row(
        "SELECT id, role, title, file_name, display_name, file_path, duration, text
         FROM audio_records
         WHERE id = ?1",
        params![id],
        |row| {
            Ok(AudioFileItem {
                id: row.get(0)?,
                role: row.get(1)?,
                title: row.get(2)?,
                file_name: row.get(3)?,
                display_name: row.get(4)?,
                file_path: Some(row.get::<_, String>(5)?),
                duration: row.get(6)?,
                duration_seconds: None,
                start_time: None,
                end_time: None,
                text: row.get(7)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("读取音频记录失败: {e}"))
}

fn load_audio_record_by_id(app: &AppHandle, id: &str) -> Result<Option<AudioFileItem>, String> {
    let conn = open_workspace_db(app)?;
    load_audio_record_by_id_from_conn(&conn, id)
}

fn load_audio_generation_segments_from_conn(conn: &Connection, task_id: &str) -> Result<Vec<AudioGenerationSegmentItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, segment_index, speaker, text, status, file_name, file_path, error_message, attempt_count, created_at, updated_at
             FROM audio_generation_segments
             WHERE task_id = ?1
             ORDER BY segment_index ASC, rowid ASC",
        )
        .map_err(|e| format!("查询音频任务分段失败: {e}"))?;

    let mut rows = stmt
        .query(params![task_id])
        .map_err(|e| format!("读取音频任务分段失败: {e}"))?;
    let mut segments = Vec::new();

    while let Some(row) = rows.next().map_err(|e| format!("读取音频任务分段失败: {e}"))? {
        segments.push(AudioGenerationSegmentItem {
            id: row.get(0).map_err(|e| format!("解析音频任务分段失败: {e}"))?,
            segment_index: row.get::<_, i64>(1).map_err(|e| format!("解析音频任务分段失败: {e}"))? as u32,
            speaker: row.get(2).map_err(|e| format!("解析音频任务分段失败: {e}"))?,
            text: row.get(3).map_err(|e| format!("解析音频任务分段失败: {e}"))?,
            status: row.get(4).map_err(|e| format!("解析音频任务分段失败: {e}"))?,
            file_name: row.get(5).map_err(|e| format!("解析音频任务分段失败: {e}"))?,
            file_path: row.get(6).map_err(|e| format!("解析音频任务分段失败: {e}"))?,
            error_message: row.get(7).map_err(|e| format!("解析音频任务分段失败: {e}"))?,
            attempt_count: row.get::<_, i64>(8).map_err(|e| format!("解析音频任务分段失败: {e}"))? as u32,
            created_at: row.get(9).map_err(|e| format!("解析音频任务分段失败: {e}"))?,
            updated_at: row.get(10).map_err(|e| format!("解析音频任务分段失败: {e}"))?,
        });
    }

    Ok(segments)
}

fn load_audio_generation_task_state_from_conn(conn: &Connection, task_id: &str) -> Result<AudioGenerationTaskState, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, batch_id, status, audio_dir, tts_endpoint_id, transcript_json, total_segments, success_segments, failed_segments, merged_audio_record_id, last_error, created_at, updated_at
             FROM audio_generation_tasks
             WHERE id = ?1
             LIMIT 1",
        )
        .map_err(|e| format!("查询音频任务失败: {e}"))?;
    let mut rows = stmt
        .query(params![task_id])
        .map_err(|e| format!("读取音频任务失败: {e}"))?;
    let row = rows
        .next()
        .map_err(|e| format!("读取音频任务失败: {e}"))?
        .ok_or_else(|| "未找到对应的音频任务".to_string())?;

    let transcript_json: String = row.get(5).map_err(|e| format!("解析音频任务失败: {e}"))?;
    let transcript = serde_json::from_str::<Vec<TranscriptSegment>>(&transcript_json)
        .map_err(|e| format!("解析音频任务 transcript 失败: {e}"))?;

    Ok(AudioGenerationTaskState {
        id: row.get(0).map_err(|e| format!("解析音频任务失败: {e}"))?,
        batch_id: row.get(1).map_err(|e| format!("解析音频任务失败: {e}"))?,
        status: row.get(2).map_err(|e| format!("解析音频任务失败: {e}"))?,
        audio_dir: row.get(3).map_err(|e| format!("解析音频任务失败: {e}"))?,
        tts_endpoint_id: row.get(4).map_err(|e| format!("解析音频任务失败: {e}"))?,
        transcript,
        total_segments: row.get::<_, i64>(6).map_err(|e| format!("解析音频任务失败: {e}"))? as u32,
        success_segments: row.get::<_, i64>(7).map_err(|e| format!("解析音频任务失败: {e}"))? as u32,
        failed_segments: row.get::<_, i64>(8).map_err(|e| format!("解析音频任务失败: {e}"))? as u32,
        merged_audio_record_id: row.get(9).map_err(|e| format!("解析音频任务失败: {e}"))?,
        last_error: row.get(10).map_err(|e| format!("解析音频任务失败: {e}"))?,
        created_at: row.get(11).map_err(|e| format!("解析音频任务失败: {e}"))?,
        updated_at: row.get(12).map_err(|e| format!("解析音频任务失败: {e}"))?,
    })
}

fn load_audio_generation_task_state(app: &AppHandle, task_id: &str) -> Result<AudioGenerationTaskState, String> {
    let conn = open_workspace_db(app)?;
    load_audio_generation_task_state_from_conn(&conn, task_id)
}

fn build_audio_generation_task_item_from_conn(conn: &Connection, task_state: AudioGenerationTaskState) -> Result<AudioGenerationTaskItem, String> {
    let segments = load_audio_generation_segments_from_conn(conn, &task_state.id)?;
    Ok(AudioGenerationTaskItem {
        id: task_state.id,
        batch_id: task_state.batch_id,
        status: task_state.status,
        audio_dir: task_state.audio_dir,
        tts_endpoint_id: task_state.tts_endpoint_id,
        total_segments: task_state.total_segments,
        success_segments: task_state.success_segments,
        failed_segments: task_state.failed_segments,
        merged_audio_record_id: task_state.merged_audio_record_id,
        last_error: task_state.last_error,
        created_at: task_state.created_at,
        updated_at: task_state.updated_at,
        segments,
    })
}

fn load_audio_generation_task_item(app: &AppHandle, task_id: &str) -> Result<AudioGenerationTaskItem, String> {
    let conn = open_workspace_db(app)?;
    let task_state = load_audio_generation_task_state_from_conn(&conn, task_id)?;
    build_audio_generation_task_item_from_conn(&conn, task_state)
}

fn list_audio_generation_task_states_from_conn(conn: &Connection) -> Result<Vec<AudioGenerationTaskState>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, batch_id, status, audio_dir, tts_endpoint_id, transcript_json, total_segments, success_segments, failed_segments, merged_audio_record_id, last_error, created_at, updated_at
             FROM audio_generation_tasks
             ORDER BY updated_at DESC, rowid DESC",
        )
        .map_err(|e| format!("查询音频任务列表失败: {e}"))?;
    let mut rows = stmt.query([]).map_err(|e| format!("读取音频任务列表失败: {e}"))?;
    let mut tasks = Vec::new();

    while let Some(row) = rows.next().map_err(|e| format!("读取音频任务列表失败: {e}"))? {
        let transcript_json: String = row.get(5).map_err(|e| format!("解析音频任务列表失败: {e}"))?;
        let transcript = serde_json::from_str::<Vec<TranscriptSegment>>(&transcript_json)
            .map_err(|e| format!("解析音频任务 transcript 失败: {e}"))?;
        tasks.push(AudioGenerationTaskState {
            id: row.get(0).map_err(|e| format!("解析音频任务列表失败: {e}"))?,
            batch_id: row.get(1).map_err(|e| format!("解析音频任务列表失败: {e}"))?,
            status: row.get(2).map_err(|e| format!("解析音频任务列表失败: {e}"))?,
            audio_dir: row.get(3).map_err(|e| format!("解析音频任务列表失败: {e}"))?,
            tts_endpoint_id: row.get(4).map_err(|e| format!("解析音频任务列表失败: {e}"))?,
            transcript,
            total_segments: row.get::<_, i64>(6).map_err(|e| format!("解析音频任务列表失败: {e}"))? as u32,
            success_segments: row.get::<_, i64>(7).map_err(|e| format!("解析音频任务列表失败: {e}"))? as u32,
            failed_segments: row.get::<_, i64>(8).map_err(|e| format!("解析音频任务列表失败: {e}"))? as u32,
            merged_audio_record_id: row.get(9).map_err(|e| format!("解析音频任务列表失败: {e}"))?,
            last_error: row.get(10).map_err(|e| format!("解析音频任务列表失败: {e}"))?,
            created_at: row.get(11).map_err(|e| format!("解析音频任务列表失败: {e}"))?,
            updated_at: row.get(12).map_err(|e| format!("解析音频任务列表失败: {e}"))?,
        });
    }

    Ok(tasks)
}

fn summarize_audio_generation_task_from_conn(conn: &Connection, task_id: &str) -> Result<AudioGenerationTaskSummary, String> {
    conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(CASE WHEN status = ?2 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = ?3 THEN 1 ELSE 0 END), 0)
         FROM audio_generation_segments
         WHERE task_id = ?1",
        params![task_id, AUDIO_SEGMENT_STATUS_SUCCEEDED, AUDIO_SEGMENT_STATUS_FAILED],
        |row| {
            Ok(AudioGenerationTaskSummary {
                total_segments: row.get::<_, i64>(0)? as u32,
                success_segments: row.get::<_, i64>(1)? as u32,
                failed_segments: row.get::<_, i64>(2)? as u32,
            })
        },
    )
    .map_err(|e| format!("汇总音频任务状态失败: {e}"))
}

fn refresh_audio_generation_task(
    app: &AppHandle,
    task_id: &str,
    status: &str,
    merged_audio_record_id: Option<&str>,
    last_error: Option<&str>,
) -> Result<AudioGenerationTaskItem, String> {
    let conn = open_workspace_db(app)?;
    let summary = summarize_audio_generation_task_from_conn(&conn, task_id)?;
    conn.execute(
        "UPDATE audio_generation_tasks
         SET status = ?1,
             total_segments = ?2,
             success_segments = ?3,
             failed_segments = ?4,
             merged_audio_record_id = ?5,
             last_error = ?6,
             updated_at = ?7
         WHERE id = ?8",
        params![
            status,
            summary.total_segments,
            summary.success_segments,
            summary.failed_segments,
            merged_audio_record_id,
            last_error,
            now_text(),
            task_id,
        ],
    )
    .map_err(|e| format!("更新音频任务状态失败: {e}"))?;

    let task_state = load_audio_generation_task_state_from_conn(&conn, task_id)?;
    build_audio_generation_task_item_from_conn(&conn, task_state)
}

fn create_audio_generation_task(
    app: &AppHandle,
    batch_id: &str,
    audio_dir: &str,
    tts_endpoint_id: &str,
    transcript: &[TranscriptSegment],
    jobs: &[AudioGenerationJob],
) -> Result<AudioGenerationTaskItem, String> {
    let conn = open_workspace_db(app)?;
    let task_id = format!("audio-task-{batch_id}");
    let created_at = now_text();
    let transcript_json = serde_json::to_string(transcript).map_err(|e| format!("序列化音频任务 transcript 失败: {e}"))?;

    conn.execute(
        "INSERT INTO audio_generation_tasks(
            id, batch_id, status, audio_dir, tts_endpoint_id, transcript_json, total_segments, success_segments, failed_segments, merged_audio_record_id, last_error, created_at, updated_at
        ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, NULL, NULL, ?8, ?8)",
        params![
            task_id,
            batch_id,
            AUDIO_TASK_STATUS_PENDING,
            audio_dir,
            tts_endpoint_id,
            transcript_json,
            jobs.len() as u32,
            created_at,
        ],
    )
    .map_err(|e| format!("创建音频任务失败: {e}"))?;

    for job in jobs {
        conn.execute(
            "INSERT INTO audio_generation_segments(
                id, task_id, segment_index, speaker, text, status, file_name, file_path, error_message, attempt_count, created_at, updated_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8, ?9, ?9)",
            params![
                job.segment_id,
                task_id,
                job.segment_index,
                job.speaker,
                job.text,
                AUDIO_SEGMENT_STATUS_PENDING,
                job.file_name,
                job.attempt_count,
                created_at,
            ],
        )
        .map_err(|e| format!("创建音频任务分段失败: {e}"))?;
    }

    let task_state = load_audio_generation_task_state_from_conn(&conn, &task_id)?;
    build_audio_generation_task_item_from_conn(&conn, task_state)
}

fn mark_audio_generation_segments_processing(app: &AppHandle, jobs: &[AudioGenerationJob]) -> Result<(), String> {
    if jobs.is_empty() {
        return Ok(());
    }

    let conn = open_workspace_db(app)?;
    let updated_at = now_text();
    for job in jobs {
        conn.execute(
            "UPDATE audio_generation_segments
             SET status = ?1,
                 error_message = NULL,
                 updated_at = ?2
             WHERE id = ?3",
            params![AUDIO_SEGMENT_STATUS_PROCESSING, updated_at, job.segment_id],
        )
        .map_err(|e| format!("更新音频任务分段状态失败: {e}"))?;
    }
    Ok(())
}

fn mark_audio_generation_segment_succeeded(app: &AppHandle, job: &AudioGenerationJob) -> Result<(), String> {
    let conn = open_workspace_db(app)?;
    conn.execute(
        "UPDATE audio_generation_segments
         SET status = ?1,
             file_name = ?2,
             file_path = ?3,
             error_message = NULL,
             attempt_count = ?4,
             updated_at = ?5
         WHERE id = ?6",
        params![
            AUDIO_SEGMENT_STATUS_SUCCEEDED,
            job.file_name,
            job.file_path.to_string_lossy().to_string(),
            job.attempt_count + 1,
            now_text(),
            job.segment_id,
        ],
    )
    .map_err(|e| format!("更新音频任务成功分段失败: {e}"))?;
    Ok(())
}

fn mark_audio_generation_segment_failed(app: &AppHandle, job: &AudioGenerationJob, error_message: &str) -> Result<(), String> {
    let conn = open_workspace_db(app)?;
    conn.execute(
        "UPDATE audio_generation_segments
         SET status = ?1,
             file_name = ?2,
             file_path = NULL,
             error_message = ?3,
             attempt_count = ?4,
             updated_at = ?5
         WHERE id = ?6",
        params![
            AUDIO_SEGMENT_STATUS_FAILED,
            job.file_name,
            error_message,
            job.attempt_count + 1,
            now_text(),
            job.segment_id,
        ],
    )
    .map_err(|e| format!("更新音频任务失败分段失败: {e}"))?;
    Ok(())
}

fn build_merged_audio_file(task_state: &AudioGenerationTaskState, merged_path: &Path) -> AudioFileItem {
    let merged_name = format!("merged_{}.wav", task_state.batch_id);
    let merged_text = task_state
        .transcript
        .iter()
        .map(|segment| format!("{}: {}", segment.speaker, segment.text))
        .collect::<Vec<_>>()
        .join("\n");
    let merged_duration_seconds = transcript_total_duration_seconds(&task_state.transcript);

    AudioFileItem {
        id: format!("audio-merged-{}", task_state.batch_id),
        role: "merged".into(),
        title: merged_audio_title(),
        file_name: merged_name,
        display_name: None,
        duration: format_duration_mm_ss(merged_duration_seconds),
        duration_seconds: Some(merged_duration_seconds),
        start_time: Some(0),
        end_time: Some(merged_duration_seconds),
        file_path: Some(merged_path.to_string_lossy().to_string()),
        text: Some(merged_text),
    }
}

async fn process_audio_generation_task(
    app: &AppHandle,
    config: &AppConfig,
    task_state: &AudioGenerationTaskState,
    jobs: Vec<AudioGenerationJob>,
    output_dir: &Path,
) -> Result<AudioGenerationProcessResult, String> {
    let mut last_error: Option<String> = None;

    if !jobs.is_empty() {
        mark_audio_generation_segments_processing(app, &jobs)?;
        refresh_audio_generation_task(app, &task_state.id, AUDIO_TASK_STATUS_PROCESSING, task_state.merged_audio_record_id.as_deref(), None)?;

        let endpoint = resolve_tts_endpoint(config, &task_state.tts_endpoint_id)?;
        let provider = endpoint.provider.clone();
        let endpoint_id = endpoint.id.clone();
        let app_handle = app.clone();
        let config_clone = config.clone();

        let results = stream::iter(jobs.into_iter().map(|job| {
            let app_handle = app_handle.clone();
            let config_clone = config_clone.clone();
            let endpoint_id = endpoint_id.clone();
            async move {
                match synthesize_audio_bytes(&app_handle, &config_clone, &endpoint_id, &job.speaker, &job.text).await {
                    Ok(bytes) => AudioGenerationJobResult {
                        job,
                        bytes: Some(bytes),
                        error_message: None,
                    },
                    Err(error_message) => AudioGenerationJobResult {
                        job,
                        bytes: None,
                        error_message: Some(error_message),
                    },
                }
            }
        }))
        .buffer_unordered(AUDIO_TTS_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

        for result in results {
            if let Some(bytes) = result.bytes {
                fs::write(&result.job.file_path, &bytes).map_err(|e| format!("写入音频片段失败: {e}"))?;
                mark_audio_generation_segment_succeeded(app, &result.job)?;
                write_backend_log(
                    app,
                    "info",
                    "audio",
                    "desktop/src-tauri/src/lib.rs::process_audio_generation_task",
                    "音频片段合成成功",
                    Some(format!(
                        "task_id={} index={} endpoint={} provider={} path={}",
                        task_state.id,
                        result.job.segment_index + 1,
                        endpoint_id,
                        provider,
                        result.job.file_path.to_string_lossy()
                    )),
                );
                continue;
            }

            if let Some(error_message) = result.error_message {
                if last_error.is_none() {
                    last_error = Some(error_message.clone());
                }
                mark_audio_generation_segment_failed(app, &result.job, &error_message)?;
                write_backend_log(
                    app,
                    "error",
                    "audio",
                    "desktop/src-tauri/src/lib.rs::process_audio_generation_task",
                    "音频片段合成失败",
                    Some(format!(
                        "task_id={} index={} endpoint={} provider={} error={}",
                        task_state.id,
                        result.job.segment_index + 1,
                        endpoint_id,
                        provider,
                        error_message
                    )),
                );
            }
        }
    }

    let current_task = load_audio_generation_task_state(app, &task_state.id)?;
    if current_task.failed_segments > 0 {
        let task = refresh_audio_generation_task(
            app,
            &task_state.id,
            AUDIO_TASK_STATUS_PARTIAL_FAILED,
            current_task.merged_audio_record_id.as_deref(),
            last_error.as_deref().or(current_task.last_error.as_deref()),
        )?;
        return Ok(AudioGenerationProcessResult {
            task,
            merged_file: None,
        });
    }

    if current_task.success_segments == 0 {
        let task = refresh_audio_generation_task(
            app,
            &task_state.id,
            AUDIO_TASK_STATUS_PARTIAL_FAILED,
            current_task.merged_audio_record_id.as_deref(),
            Some("未生成任何可用音频片段，请检查当前 TTS 配置后重试。"),
        )?;
        return Ok(AudioGenerationProcessResult {
            task,
            merged_file: None,
        });
    }

    if let Some(merged_audio_record_id) = current_task.merged_audio_record_id.clone() {
        let merged_file = load_audio_record_by_id(app, &merged_audio_record_id)?;
        let task = load_audio_generation_task_item(app, &task_state.id)?;
        return Ok(AudioGenerationProcessResult { task, merged_file });
    }

    let segments = load_audio_generation_segments_from_conn(&open_workspace_db(app)?, &task_state.id)?;
    let mut chunks = Vec::with_capacity(segments.len());
    for segment in segments {
        let file_path = segment
            .file_path
            .ok_or_else(|| format!("分段 {} 缺少音频文件路径", segment.segment_index + 1))?;
        let bytes = fs::read(&file_path).map_err(|e| format!("读取音频片段失败: {e}"))?;
        chunks.push(bytes);
    }

    let merged_path = output_dir.join(format!("merged_{}.wav", current_task.batch_id));
    merge_audio_segments_to_wav(&merged_path, &chunks)?;
    let merged_file = build_merged_audio_file(&current_task, &merged_path);
    persist_audio_record(app, &current_task.batch_id, &merged_file)?;
    write_backend_log(
        app,
        "info",
        "audio",
        "desktop/src-tauri/src/lib.rs::process_audio_generation_task",
        "合并音频输出完成",
        Some(format!("task_id={} path={}", task_state.id, merged_path.to_string_lossy())),
    );

    let task = refresh_audio_generation_task(
        app,
        &task_state.id,
        AUDIO_TASK_STATUS_COMPLETED,
        Some(&merged_file.id),
        None,
    )?;

    Ok(AudioGenerationProcessResult {
        task,
        merged_file: Some(merged_file),
    })
}

#[tauri::command]
fn list_audio_generation_tasks(app: AppHandle) -> Result<Vec<AudioGenerationTaskItem>, String> {
    let conn = open_workspace_db(&app)?;
    let task_states = list_audio_generation_task_states_from_conn(&conn)?;
    task_states
        .into_iter()
        .map(|task_state| build_audio_generation_task_item_from_conn(&conn, task_state))
        .collect()
}

#[tauri::command]
async fn retry_audio_generation_task(app: AppHandle, task_id: String) -> Result<GenerateAudioOutput, String> {
    let workspace = ensure_workspace(&app)?;
    let config = workspace.config;
    let task_state = load_audio_generation_task_state(&app, &task_id)?;
    let data_dir = app_data_dir(&app)?;
    let root_output_dir = ensure_output_dir(&data_dir, &task_state.audio_dir)?;
    let output_dir = root_output_dir.join(&task_state.batch_id);
    fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {e}"))?;

    let tts_config = resolve_tts_endpoint(&config, &task_state.tts_endpoint_id)?;
    let segment_extension = audio_file_extension(&tts_config.provider);
    let segments = load_audio_generation_segments_from_conn(&open_workspace_db(&app)?, &task_state.id)?;
    let jobs = segments
        .into_iter()
        .filter(|segment| segment.status != AUDIO_SEGMENT_STATUS_SUCCEEDED)
        .map(|segment| AudioGenerationJob {
            segment_id: segment.id,
            segment_index: segment.segment_index,
            speaker: segment.speaker.clone(),
            text: segment.text.clone(),
            file_name: segment
                .file_name
                .unwrap_or_else(|| format!("task_{:02}_{}.{}", segment.segment_index + 1, segment.speaker, segment_extension)),
            file_path: output_dir.join(format!(
                "task_{:02}_{}.{}",
                segment.segment_index + 1,
                segment.speaker,
                segment_extension
            )),
            attempt_count: segment.attempt_count,
        })
        .collect::<Vec<_>>();

    let process_result = process_audio_generation_task(&app, &config, &task_state, jobs, &output_dir).await?;
    let audio_files = process_result
        .merged_file
        .clone()
        .map(|file| vec![file])
        .unwrap_or_default();

    Ok(GenerateAudioOutput {
        task: process_result.task,
        audio_files,
        merged_file: process_result.merged_file,
    })
}

fn load_audio_records(app: &AppHandle) -> Result<Vec<AudioFileItem>, String> {
    let conn = open_workspace_db(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, role, title, file_name, display_name, file_path, duration, text
             FROM audio_records
             ORDER BY created_at DESC, rowid DESC",
        )
        .map_err(|e| format!("查询音频记录失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(AudioFileItem {
                id: row.get(0)?,
                role: row.get(1)?,
                title: row.get(2)?,
                file_name: row.get(3)?,
                display_name: row.get(4)?,
                file_path: Some(row.get::<_, String>(5)?),
                duration: row.get(6)?,
                duration_seconds: None,
                start_time: None,
                end_time: None,
                text: row.get(7)?,
            })
        })
        .map_err(|e| format!("读取音频记录失败: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("解析音频记录失败: {e}"))
}

#[tauri::command]
fn update_audio_display_name(app: AppHandle, id: String, display_name: String) -> Result<AudioFileItem, String> {
    let trimmed_display_name = display_name.trim().to_string();
    if trimmed_display_name.is_empty() {
        return Err("备注名称不能为空".into());
    }
    if trimmed_display_name.chars().count() > 60 {
        return Err("备注名称不能超过 60 个字符".into());
    }

    let conn = open_workspace_db(&app)?;
    conn.execute(
        "UPDATE audio_records
         SET display_name = ?1
         WHERE id = ?2 AND role = 'merged'",
        params![trimmed_display_name, id],
    )
    .map_err(|e| format!("更新音频备注失败: {e}"))?;

    let updated = conn
        .query_row(
            "SELECT id, role, title, file_name, display_name, file_path, duration, text
             FROM audio_records
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(AudioFileItem {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    title: row.get(2)?,
                    file_name: row.get(3)?,
                    display_name: row.get(4)?,
                    file_path: Some(row.get::<_, String>(5)?),
                    duration: row.get(6)?,
                    duration_seconds: None,
                    start_time: None,
                    end_time: None,
                    text: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("读取更新后的音频失败: {e}"))?
        .ok_or_else(|| "未找到对应的音频记录".to_string())?;

    Ok(updated)
}

fn load_workspace_from_db(app: &AppHandle) -> Result<Option<WorkspaceData>, String> {
    let conn = open_workspace_db(app)?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_state WHERE key = ?1",
            params!["workspace"],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("读取工作区数据失败: {e}"))?;

    raw.map(|text| serde_json::from_str(&text).map_err(|e| format!("解析工作区数据失败: {e}")))
        .transpose()
}

fn persist_workspace_to_db(app: &AppHandle, workspace: &WorkspaceData) -> Result<(), String> {
    let conn = open_workspace_db(app)?;
    let text = serde_json::to_string(workspace).map_err(|e| format!("序列化工作区失败: {e}"))?;
    conn.execute(
        "INSERT INTO app_state(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params!["workspace", text],
    )
    .map_err(|e| format!("写入工作区数据失败: {e}"))?;
    Ok(())
}

fn default_prompt_templates() -> Vec<PromptTemplate> {
    vec![PromptTemplate {
        id: "default-prompt".into(),
        title: "默认销售教练 Prompt".into(),
        description: "通用销售对话生成模板，支持把当前场景、轮数和补充要求直接写入正文。".into(),
        system_prompt: "你是一名资深销售对话教练，负责生成销售与客户之间的中文多轮模拟对话。

# 对话背景
- 当前场景：{{scenario}}
- 目标轮数：{{rounds}}
- 补充要求：{{supplementalPrompt}}

# 生成目标
请基于上面的真实业务场景，生成一段更贴近实际成交推进过程的销售对话。

# 对话要求
- 销售表达要专业、自然、克制，重点是理解客户、建立信任、推动下一步，而不是强行逼单
- 客户要有真实反应，允许出现顾虑、犹豫、质疑、拖延、比较价格、暂时不想决定等情况，不能一直顺着销售
- 对话要围绕场景逐步推进，每一轮都要承接上一轮的信息，不要重复空话
- 销售需要结合客户反馈动态调整说法，可以做解释、追问、确认需求、弱推动、给出下一步建议
- 不要出现明显机器人口吻，不要写成说明文，不要总结，不要加旁白
- 不要承诺无法兑现的政策、收益或结果
- 如果补充要求不为空，必须优先吸收进对话语气、推进方式和内容重点里

# 输出格式
- 严格返回 JSON 数组，不要输出 Markdown、代码块或任何额外解释
- 每个元素必须是 {\"speaker\":\"sales|customer\",\"text\":\"...\"}
- speaker 只能是 sales 或 customer
- text 必须是自然中文口语，不要带序号或角色名前缀".into(),
    }]
}

fn render_system_prompt_template(template: &str, input: &GenerateConversationInput) -> String {
    let replacements = [
        ("scenario", input.scenario.trim()),
        ("rounds", ""),
        (
            "supplementalPrompt",
            input
                .supplemental_prompt
                .as_deref()
                .map(str::trim)
                .unwrap_or(""),
        ),
    ];

    let mut rendered = template.replace("{{rounds}}", &input.rounds.to_string());
    for (key, value) in replacements {
        if key == "rounds" {
            continue;
        }
        rendered = rendered.replace(&format!("{{{{{key}}}}}"), value);
    }
    rendered
}

fn default_audio_dir(app: &AppHandle) -> Result<String, String> {
    Ok(app_data_dir(app)?.join("audio").to_string_lossy().to_string())
}

fn resolved_database_path(app: &AppHandle) -> Result<String, String> {
    Ok(workspace_db_path(app)?.to_string_lossy().to_string())
}

fn resolved_config_file() -> String {
    "内置 SQLite 配置".into()
}

fn now_text() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn unique_batch_id() -> String {
    format!("{}", Local::now().format("%Y%m%d%H%M%S%3f"))
}

fn ensure_output_dir(data_dir: &Path, requested_audio_dir: &str) -> Result<PathBuf, String> {
    let audio_dir = requested_audio_dir.trim();
    if audio_dir.is_empty() {
        return Ok(data_dir.join("audio"));
    }

    let candidate = PathBuf::from(audio_dir);
    if candidate.is_absolute() {
        return Ok(candidate);
    }

    Ok(data_dir.join(audio_dir.trim_start_matches("./")))
}

fn audio_file_extension(provider: &str) -> &'static str {
    match provider {
        "openai" | "elevenlabs" => "mp3",
        "qwen" => "wav",
        _ => "wav",
    }
}

fn merged_audio_title() -> String {
    "合并音频".into()
}

fn transcript_total_duration_seconds(transcript: &[TranscriptSegment]) -> u32 {
    transcript
        .iter()
        .map(|segment| segment.end_time)
        .max()
        .unwrap_or(0)
}

fn format_duration_mm_ss(total_seconds: u32) -> String {
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    format!("{:02}:{:02}", minutes, seconds)
}

#[tauri::command]
fn list_audio_files(app: AppHandle) -> Result<Vec<AudioFileItem>, String> {
    load_audio_records(&app)
}

fn default_config(app: &AppHandle) -> Result<AppConfig, String> {
    Ok(AppConfig {
        active_llm_id: "default-llm".into(),
        llm_endpoints: vec![LlmEndpointConfig {
            id: "default-llm".into(),
            title: "默认 OpenAI".into(),
            provider: "openai".into(),
            api_key: String::new(),
            base_url: "https://api.openai.com/v1".into(),
            model: "".into(),
        }],
        active_tts_id: "default-tts".into(),
        tts_endpoints: vec![TtsEndpointConfig {
            id: "default-tts".into(),
            title: "默认 Edge".into(),
            provider: "edge".into(),
            api_key: String::new(),
            base_url: "".into(),
            tts_model: "edge-local".into(),
            sales_voice: "zh-CN-YunxiNeural".into(),
            customer_voice: "zh-CN-XiaoxiaoNeural".into(),
        }],
        active_prompt_id: "default-prompt".into(),
        audio_dir: default_audio_dir(app)?,
        database_path: resolved_database_path(app)?,
        config_file: resolved_config_file(),
        ..Default::default()
    })
}

fn default_workspace(app: &AppHandle) -> Result<WorkspaceData, String> {
    Ok(WorkspaceData {
        config: default_config(app)?,
        prompts: default_prompt_templates(),
    })
}

fn ensure_prompt_defaults(workspace: &mut WorkspaceData) -> bool {
    let mut modified = false;

    if workspace.prompts.is_empty() {
        workspace.prompts = default_prompt_templates();
        modified = true;
    }

    let active_prompt_exists = workspace
        .prompts
        .iter()
        .any(|prompt| prompt.id == workspace.config.active_prompt_id);
    if !active_prompt_exists {
        workspace.config.active_prompt_id = workspace
            .prompts
            .first()
            .map(|prompt| prompt.id.clone())
            .unwrap_or_default();
        modified = true;
    }

    modified
}

fn normalize_config_paths(app: &AppHandle, config: &mut AppConfig) -> Result<(), String> {
    let default_audio = default_audio_dir(app)?;
    let normalized_default_audio = PathBuf::from(&default_audio);
    let current_audio = config.audio_dir.trim();

    if current_audio.is_empty() || current_audio == "./storage/audio" {
        config.audio_dir = default_audio;
    } else {
        let candidate = PathBuf::from(current_audio);
        let normalized_candidate = if candidate.is_absolute() {
            candidate
        } else {
            app_data_dir(app)?.join(current_audio.trim_start_matches("./"))
        };

        let is_legacy_backend_audio = normalized_candidate == app_data_dir(app)?.join("backend").join("audio");
        let is_legacy_root_audio = normalized_candidate == app_data_dir(app)?.join("audio");

        if is_legacy_backend_audio || is_legacy_root_audio {
            config.audio_dir = normalized_default_audio.to_string_lossy().to_string();
        } else {
            config.audio_dir = normalized_candidate.to_string_lossy().to_string();
        }
    }
    config.database_path = resolved_database_path(app)?;
    config.config_file = resolved_config_file();
    Ok(())
}

fn ensure_workspace(app: &AppHandle) -> Result<WorkspaceData, String> {
    if let Some(mut workspace) = load_workspace_from_db(app)? {
        let before = serde_json::to_string(&workspace).map_err(|e| format!("序列化工作区失败: {e}"))?;
        let mut modified = ensure_prompt_defaults(&mut workspace);
        normalize_config_paths(app, &mut workspace.config)?;
        let after = serde_json::to_string(&workspace).map_err(|e| format!("序列化工作区失败: {e}"))?;
        modified = modified || before != after;
        if modified {
            persist_workspace_to_db(app, &workspace)?;
        }
        remove_legacy_files_with_log(app, "desktop/src-tauri/src/lib.rs::ensure_workspace")?;
        return Ok(workspace);
    }

    // 旧 workspace.json 只在首次迁移时读取；后续统一以 SQLite 为唯一来源。
    let legacy_path = legacy_workspace_file(app)?;
    if !legacy_path.exists() {
        let workspace = default_workspace(app)?;
        persist_workspace_to_db(app, &workspace)?;
        remove_legacy_files_with_log(app, "desktop/src-tauri/src/lib.rs::ensure_workspace")?;
        write_backend_log(
            app,
            "info",
            "workspace",
            "desktop/src-tauri/src/lib.rs::ensure_workspace",
            "首次创建 SQLite 工作区",
            Some(format!("db={}", workspace_db_path(app)?.to_string_lossy())),
        );
        return Ok(workspace);
    }

    let content = fs::read_to_string(&legacy_path).map_err(|e| format!("读取历史工作区文件失败: {e}"))?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("解析历史工作区文件失败: {e}"))?;
    let mut workspace: WorkspaceData = serde_json::from_value(value.clone()).map_err(|e| format!("解析历史工作区文件失败: {e}"))?;

    let mut modified = false;
    if workspace.config.llm_endpoints.is_empty() && !workspace.config.llm_provider.is_empty() {
        workspace.config.active_llm_id = "migrated-llm".into();
        workspace.config.llm_endpoints.push(LlmEndpointConfig {
            id: "migrated-llm".into(),
            title: "历史配置".into(),
            provider: workspace.config.llm_provider.clone(),
            api_key: workspace.config.llm_api_key.clone(),
            base_url: workspace.config.llm_base_url.clone(),
            model: workspace.config.llm_model.clone(),
        });
        modified = true;
    }
    if workspace.config.tts_endpoints.is_empty() && !workspace.config.tts_provider.is_empty() {
        workspace.config.active_tts_id = "migrated-tts".into();
        workspace.config.tts_endpoints.push(TtsEndpointConfig {
            id: "migrated-tts".into(),
            title: "历史配置".into(),
            provider: workspace.config.tts_provider.clone(),
            api_key: workspace.config.tts_api_key.clone(),
            base_url: workspace.config.tts_base_url.clone(),
            tts_model: workspace.config.tts_model.clone(),
            sales_voice: workspace.config.sales_voice.clone(),
            customer_voice: workspace.config.customer_voice.clone(),
        });
        modified = true;
    }
    if ensure_prompt_defaults(&mut workspace) {
        modified = true;
    }

    normalize_config_paths(app, &mut workspace.config)?;
    let normalized = serde_json::to_value(&workspace).map_err(|e| format!("序列化工作区失败: {e}"))?;
    if normalized != value || modified {
        write_backend_log(
            app,
            "info",
            "workspace",
            "desktop/src-tauri/src/lib.rs::ensure_workspace",
            "已从历史 workspace.json 迁移工作区到 SQLite",
            Some(format!(
                "legacy={} db={}",
                legacy_path.to_string_lossy(),
                workspace_db_path(app)?.to_string_lossy()
            )),
        );
    }
    persist_workspace_to_db(app, &workspace)?;
    remove_legacy_files_with_log(app, "desktop/src-tauri/src/lib.rs::ensure_workspace")?;
    Ok(workspace)
}

fn save_workspace(app: &AppHandle, workspace: &WorkspaceData) -> Result<(), String> {
    persist_workspace_to_db(app, workspace)
}


fn extract_json_block(content: &str) -> Option<String> {
    if content.trim_start().starts_with('[') {
        return Some(content.trim().to_string());
    }

    let fenced = content.replace("```json", "```");
    let fenced = fenced.split("```").find(|part| part.contains('['))?;
    let start = fenced.find('[')?;
    let end = fenced.rfind(']')?;
    Some(fenced[start..=end].to_string())
}

fn extract_text_from_json_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(text.clone())
            }
        }
        serde_json::Value::Array(items) => {
            let collected = items
                .iter()
                .filter_map(extract_text_from_json_value)
                .collect::<String>();
            if collected.trim().is_empty() {
                None
            } else {
                Some(collected)
            }
        }
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(extract_text_from_json_value) {
                return Some(text);
            }
            if let Some(text) = map.get("content").and_then(extract_text_from_json_value) {
                return Some(text);
            }
            if let Some(text) = map.get("value").and_then(extract_text_from_json_value) {
                return Some(text);
            }
            if let Some(text) = map.get("output_text").and_then(extract_text_from_json_value) {
                return Some(text);
            }
            None
        }
        _ => None,
    }
}

fn extract_openai_stream_delta_content(text: &str) -> Result<Option<String>, serde_json::Error> {
    let payload: OpenAiStreamResponse = serde_json::from_str(text)?;
    Ok(payload.choices.into_iter().find_map(|choice| {
        choice
            .delta
            .as_ref()
            .and_then(|delta| delta.content.as_ref())
            .and_then(extract_text_from_json_value)
            .or_else(|| {
                choice
                    .message
                    .as_ref()
                    .and_then(|delta| delta.content.as_ref())
                    .and_then(extract_text_from_json_value)
            })
            .or_else(|| choice.text.filter(|value| !value.trim().is_empty()))
    }))
}

fn extract_anthropic_stream_delta_content(text: &str) -> Result<ParsedSseEvent, serde_json::Error> {
    let payload: AnthropicStreamEvent = serde_json::from_str(text)?;
    Ok(match payload.event_type.as_str() {
        "content_block_delta" => {
            let delta = payload.delta.and_then(|delta| {
                if delta.delta_type == "text_delta" {
                    delta.text.filter(|value| !value.trim().is_empty())
                } else {
                    None
                }
            });

            match delta {
                Some(text) => ParsedSseEvent::TextDelta(text),
                None => ParsedSseEvent::Ignore,
            }
        }
        "error" => ParsedSseEvent::Error(
            payload
                .error
                .map(|error| error.message)
                .filter(|message| !message.trim().is_empty())
                .unwrap_or_else(|| "模型流式响应返回错误事件".into()),
        ),
        "message_start" | "content_block_start" | "content_block_stop" | "message_delta" | "message_stop" | "ping" => {
            ParsedSseEvent::Ignore
        }
        _ => ParsedSseEvent::Ignore,
    })
}

fn normalize_sse_buffer(buffer: &mut String) {
    if buffer.contains("\r\n") {
        *buffer = buffer.replace("\r\n", "\n");
    }
}

fn parse_sse_frame(frame: &str) -> Option<SseFrame> {
    let mut event_name: Option<String> = None;
    let mut data_lines = Vec::new();

    for line in frame.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(':') {
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("event:") {
            let value = value.trim();
            if !value.is_empty() {
                event_name = Some(value.to_string());
            }
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("data:") {
            data_lines.push(value.trim().to_string());
        }
    }

    if data_lines.is_empty() {
        return None;
    }

    Some(SseFrame {
        event: event_name,
        data: data_lines.join("\n"),
    })
}

fn parse_stream_frame(protocol: LlmStreamProtocol, frame: &SseFrame) -> Result<ParsedSseEvent, StreamFrameIssue> {
    let data = frame.data.trim();
    if data.is_empty() {
        return Ok(ParsedSseEvent::Ignore);
    }

    match protocol {
        LlmStreamProtocol::OpenAiCompatible => {
            if data == OPENAI_STREAM_DONE_SENTINEL {
                return Ok(ParsedSseEvent::Ignore);
            }

            extract_openai_stream_delta_content(data)
                .map(|result| match result {
                    Some(delta) => ParsedSseEvent::TextDelta(delta),
                    None => ParsedSseEvent::Ignore,
                })
                .map_err(|error| {
                    StreamFrameIssue::from_error(
                        data.chars().take(FRAME_PREVIEW_LIMIT).collect(),
                        error.to_string(),
                    )
                })
        }
        LlmStreamProtocol::AnthropicMessages => {
            let parse_target = if matches!(frame.event.as_deref(), Some(event) if !event.trim().is_empty()) {
                data
            } else {
                data
            };

            extract_anthropic_stream_delta_content(parse_target).map_err(|error| {
                StreamFrameIssue::from_error(
                    parse_target.chars().take(FRAME_PREVIEW_LIMIT).collect(),
                    error.to_string(),
                )
            })
        }
    }
}

fn build_llm_request_payload(
    llm_config: &LlmEndpointConfig,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<LlmRequestPayload, String> {
    let base_url = llm_config.base_url.trim_end_matches('/');
    if base_url.is_empty() {
        return Err("未配置 LLM Base URL".into());
    }

    let protocol = LlmStreamProtocol::from_provider(&llm_config.provider);
    match protocol {
        LlmStreamProtocol::AnthropicMessages => {
            let request = AnthropicMessagesRequest {
                model: llm_config.model.clone(),
                system: system_prompt.to_string(),
                messages: vec![AnthropicMessage {
                    role: "user".into(),
                    content: vec![AnthropicTextBlock {
                        block_type: "text".into(),
                        text: user_prompt.to_string(),
                    }],
                }],
                temperature: DEFAULT_LLM_TEMPERATURE,
                max_tokens: DEFAULT_ANTHROPIC_MAX_TOKENS,
                stream: true,
            };

            Ok(LlmRequestPayload {
                url: format!("{}/messages", base_url),
                headers: vec![
                    ("x-api-key", llm_config.api_key.clone()),
                    ("anthropic-version", ANTHROPIC_VERSION.to_string()),
                    (CONTENT_TYPE.as_str(), "application/json".into()),
                    (ACCEPT.as_str(), "text/event-stream".into()),
                ],
                body: serde_json::to_value(&request).map_err(|e| format!("序列化 /messages 请求体失败: {e}"))?,
                protocol,
            })
        }
        LlmStreamProtocol::OpenAiCompatible => {
            let request = OpenAiRequest {
                model: llm_config.model.clone(),
                messages: vec![
                    OpenAiMessage {
                        role: "system".into(),
                        content: system_prompt.to_string(),
                    },
                    OpenAiMessage {
                        role: "user".into(),
                        content: user_prompt.to_string(),
                    },
                ],
                temperature: DEFAULT_LLM_TEMPERATURE,
                stream: true,
            };

            Ok(LlmRequestPayload {
                url: format!("{}/chat/completions", base_url),
                headers: vec![
                    (AUTHORIZATION.as_str(), format!("Bearer {}", llm_config.api_key)),
                    (CONTENT_TYPE.as_str(), "application/json".into()),
                    (ACCEPT.as_str(), "text/event-stream".into()),
                ],
                body: serde_json::to_value(&request).map_err(|e| format!("序列化 chat/completions 请求体失败: {e}"))?,
                protocol,
            })
        }
    }
}

fn append_text_delta_and_emit(
    app: &AppHandle,
    request_id: &str,
    accumulated_content: &mut String,
    streamed_segment_count: &mut usize,
    delta: &str,
) -> Result<(), String> {
    if !delta.is_empty() {
        emit_conversation_stream_delta(app, request_id, delta)?;
        accumulated_content.push_str(delta);
    }
    let partial_transcript = build_partial_transcript(accumulated_content);
    if partial_transcript.len() > *streamed_segment_count {
        for segment in partial_transcript.iter().skip(*streamed_segment_count) {
            emit_conversation_delta(app, request_id, segment)?;
        }
        *streamed_segment_count = partial_transcript.len();
    }
    Ok(())
}

async fn consume_llm_stream(
    context: &LlmRequestContext<'_>,
    response: reqwest::Response,
    protocol: LlmStreamProtocol,
) -> Result<LlmStreamResult, String> {
    let mut stream = response.bytes_stream();
    let mut sse_buffer = String::new();
    let mut accumulated_content = String::new();
    let mut streamed_segment_count = 0usize;
    let mut unmatched_frame_preview: Option<String> = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取远程模型流失败: {e}"))?;
        let text = String::from_utf8_lossy(&chunk);
        sse_buffer.push_str(&text);
        normalize_sse_buffer(&mut sse_buffer);

        while let Some(split_at) = sse_buffer.find(SSE_FRAME_SEPARATOR) {
            let frame_text = sse_buffer[..split_at].to_string();
            sse_buffer.drain(..split_at + SSE_FRAME_SEPARATOR.len());

            let Some(frame) = parse_sse_frame(&frame_text) else {
                continue;
            };

            match parse_stream_frame(protocol, &frame) {
                Ok(ParsedSseEvent::TextDelta(delta)) => {
                    append_text_delta_and_emit(
                        context.app,
                        context.request_id,
                        &mut accumulated_content,
                        &mut streamed_segment_count,
                        &delta,
                    )?;
                }
                Ok(ParsedSseEvent::Error(message)) => {
                    let _ = emit_conversation_failed(context.app, context.request_id, &message);
                    return Err(message);
                }
                Ok(ParsedSseEvent::Ignore) => {
                    if unmatched_frame_preview.is_none() && !frame.data.trim().is_empty() {
                        unmatched_frame_preview = Some(
                            frame
                                .data
                                .trim()
                                .chars()
                                .take(FRAME_PREVIEW_LIMIT)
                                .collect(),
                        );
                    }
                }
                Err(issue) => {
                    if unmatched_frame_preview.is_none() {
                        unmatched_frame_preview = Some(issue.into_preview());
                    }
                }
            }
        }
    }

    normalize_sse_buffer(&mut sse_buffer);
    if let Some(frame) = parse_sse_frame(&sse_buffer) {
        match parse_stream_frame(protocol, &frame) {
            Ok(ParsedSseEvent::TextDelta(delta)) => {
                append_text_delta_and_emit(
                    context.app,
                    context.request_id,
                    &mut accumulated_content,
                    &mut streamed_segment_count,
                    &delta,
                )?;
            }
            Ok(ParsedSseEvent::Error(message)) => {
                let _ = emit_conversation_failed(context.app, context.request_id, &message);
                return Err(message);
            }
            Ok(ParsedSseEvent::Ignore) => {
                if unmatched_frame_preview.is_none() && !frame.data.trim().is_empty() {
                    unmatched_frame_preview = Some(frame.data.trim().chars().take(FRAME_PREVIEW_LIMIT).collect());
                }
            }
            Err(issue) => {
                if unmatched_frame_preview.is_none() {
                    unmatched_frame_preview = Some(issue.into_preview());
                }
            }
        }
    }

    Ok(LlmStreamResult {
        accumulated_content,
        streamed_segment_count,
        unmatched_frame_preview,
    })
}

fn protocol_name(protocol: LlmStreamProtocol) -> &'static str {
    match protocol {
        LlmStreamProtocol::OpenAiCompatible => "chat/completions",
        LlmStreamProtocol::AnthropicMessages => "messages",
    }
}

fn maybe_emit_remaining_partial_segments(
    app: &AppHandle,
    request_id: &str,
    accumulated_content: &str,
    streamed_segment_count: usize,
) -> Result<(), String> {
    let partial_transcript = build_partial_transcript(accumulated_content);
    if partial_transcript.len() > streamed_segment_count {
        for segment in partial_transcript.iter().skip(streamed_segment_count) {
            emit_conversation_delta(app, request_id, segment)?;
        }
    }
    Ok(())
}

fn to_log_json<T: Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_string_pretty(value)
        .unwrap_or_else(|error| format!("<serialize failed: {}>", error))
}

fn to_log_value<T: Serialize + ?Sized>(value: &T) -> serde_json::Value {
    serde_json::to_value(value)
        .unwrap_or_else(|error| serde_json::Value::String(format!("<serialize failed: {}>", error)))
}

fn mask_secret(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }

    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 8 {
        return "*".repeat(chars.len());
    }

    let prefix: String = chars.iter().take(4).collect();
    let suffix: String = chars.iter().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{}***{}", prefix, suffix)
}

fn sanitize_headers_for_log(headers: &[(impl AsRef<str>, String)]) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for (key, value) in headers {
        let key_ref = key.as_ref();
        let masked_value = match key_ref.to_ascii_lowercase().as_str() {
            "authorization" => {
                let trimmed = value.trim();
                if let Some(token) = trimmed.strip_prefix("Bearer ") {
                    format!("Bearer {}", mask_secret(token))
                } else {
                    mask_secret(trimmed)
                }
            }
            "x-api-key" | "xi-api-key" => mask_secret(value.trim()),
            _ => value.clone(),
        };
        map.insert(key_ref.to_string(), serde_json::Value::String(masked_value));
    }
    serde_json::Value::Object(map)
}

fn build_log_payload(fields: &[(&str, serde_json::Value)]) -> String {
    let mut map = serde_json::Map::new();
    for (key, value) in fields {
        map.insert((*key).to_string(), value.clone());
    }
    to_log_json(&serde_json::Value::Object(map))
}

fn build_remote_model_error_text(response_text: &str) -> String {
    if response_text.trim().is_empty() {
        "远程模型返回失败，且响应体为空".into()
    } else {
        format!("远程模型返回失败: {}", response_text)
    }
}

fn log_remote_model_failure(app: &AppHandle, endpoint_id: &str, protocol: LlmStreamProtocol, status: reqwest::StatusCode, text: &str) {
    write_backend_log(
        app,
        "error",
        "llm",
        "desktop/src-tauri/src/lib.rs::call_remote_llm",
        "远程模型返回失败",
        Some(build_log_payload(&[
            ("endpoint", serde_json::Value::String(endpoint_id.to_string())),
            (
                "protocol",
                serde_json::Value::String(protocol_name(protocol).to_string()),
            ),
            ("status", serde_json::Value::Number(serde_json::Number::from(status.as_u16()))),
            ("body", serde_json::Value::String(text.to_string())),
        ])),
    );
}

fn log_unparsed_stream_preview(app: &AppHandle, endpoint_id: &str, protocol: LlmStreamProtocol, unmatched_frame_preview: Option<String>) {
    write_backend_log(
        app,
        "warn",
        "llm",
        "desktop/src-tauri/src/lib.rs::call_remote_llm",
        "流式响应未解析出文本增量",
        unmatched_frame_preview.map(|preview| {
            build_log_payload(&[
                ("endpoint", serde_json::Value::String(endpoint_id.to_string())),
                (
                    "protocol",
                    serde_json::Value::String(protocol_name(protocol).to_string()),
                ),
                ("frame", serde_json::Value::String(preview)),
            ])
        }),
    );
}

fn log_raw_model_content(app: &AppHandle, endpoint_id: &str, protocol: LlmStreamProtocol, content: &str) {
    write_backend_log(
        app,
        "info",
        "llm",
        "desktop/src-tauri/src/lib.rs::call_remote_llm",
        "收到模型原始内容",
        Some(build_log_payload(&[
            ("endpoint", serde_json::Value::String(endpoint_id.to_string())),
            (
                "protocol",
                serde_json::Value::String(protocol_name(protocol).to_string()),
            ),
            ("content", serde_json::Value::String(content.to_string())),
        ])),
    );
}

fn log_generate_conversation_request(app: &AppHandle, input: &GenerateConversationInput) {
    write_backend_log(
        app,
        "info",
        "generate",
        "desktop/src-tauri/src/lib.rs::generate_conversation",
        "开始生成对话",
        Some(build_log_payload(&[("request", to_log_value(input))])),
    );
}

fn log_transcript_parse_success(
    app: &AppHandle,
    endpoint_id: &str,
    protocol: LlmStreamProtocol,
    transcript: &[TranscriptSegment],
) {
    write_backend_log(
        app,
        "info",
        "llm",
        "desktop/src-tauri/src/lib.rs::call_remote_llm",
        "对话解析成功",
        Some(build_log_payload(&[
            ("endpoint", serde_json::Value::String(endpoint_id.to_string())),
            (
                "protocol",
                serde_json::Value::String(protocol_name(protocol).to_string()),
            ),
            (
                "rows",
                serde_json::Value::Number(serde_json::Number::from(transcript.len())),
            ),
            (
                "transcript",
                to_log_value(transcript),
            ),
        ])),
    );
}

fn log_generate_conversation_result(app: &AppHandle, request_id: &str, output: &GenerateConversationOutput) {
    write_backend_log(
        app,
        "info",
        "generate",
        "desktop/src-tauri/src/lib.rs::generate_conversation",
        "生成对话成功",
        Some(build_log_payload(&[
            ("requestId", serde_json::Value::String(request_id.to_string())),
            (
                "response",
                to_log_value(output),
            ),
        ])),
    );
}


fn apply_request_headers(
    request: reqwest::RequestBuilder,
    headers: &[(impl AsRef<str>, String)],
) -> reqwest::RequestBuilder {
    headers.iter().fold(request, |builder, (key, value)| builder.header(key.as_ref(), value))
}

fn build_llm_request_log_payload(
    llm_config: &LlmEndpointConfig,
    input: &GenerateConversationInput,
    request_id: &str,
    protocol: LlmStreamProtocol,
    url: &str,
    headers: &[(&'static str, String)],
    request_body: &serde_json::Value,
) -> String {
    build_log_payload(&[
        ("endpoint", serde_json::Value::String(llm_config.id.clone())),
        ("provider", serde_json::Value::String(llm_config.provider.clone())),
        (
            "protocol",
            serde_json::Value::String(protocol_name(protocol).to_string()),
        ),
        ("url", serde_json::Value::String(url.to_string())),
        ("model", serde_json::Value::String(llm_config.model.clone())),
        ("requestId", serde_json::Value::String(request_id.to_string())),
        (
            "headers",
            sanitize_headers_for_log(headers),
        ),
        (
            "input",
            to_log_value(input),
        ),
        ("body", request_body.clone()),
    ])
}

fn emit_conversation_started(app: &AppHandle, request_id: &str, rounds: u32) -> Result<(), String> {
    app.emit(
        "conversation_started",
        ConversationStartedEvent {
            request_id: request_id.to_string(),
            rounds,
        },
    )
    .map_err(|e| format!("发送开始事件失败: {e}"))
}

fn emit_conversation_delta(app: &AppHandle, request_id: &str, segment: &TranscriptSegment) -> Result<(), String> {
    app.emit(
        "conversation_delta",
        ConversationDeltaEvent {
            request_id: request_id.to_string(),
            segment: segment.clone(),
        },
    )
    .map_err(|e| format!("发送增量事件失败: {e}"))
}

fn emit_conversation_stream_delta(app: &AppHandle, request_id: &str, text_delta: &str) -> Result<(), String> {
    app.emit(
        "conversation_stream_delta",
        ConversationStreamDeltaEvent {
            request_id: request_id.to_string(),
            text_delta: text_delta.to_string(),
        },
    )
    .map_err(|e| format!("发送实时文本增量事件失败: {e}"))
}

fn emit_conversation_completed(
    app: &AppHandle,
    request_id: &str,
    transcript: &[TranscriptSegment],
    task_info: &[TaskMetaItem],
) -> Result<(), String> {
    app.emit(
        "conversation_completed",
        ConversationCompletedEvent {
            request_id: request_id.to_string(),
            transcript: transcript.to_vec(),
            task_info: task_info.to_vec(),
        },
    )
    .map_err(|e| format!("发送完成事件失败: {e}"))
}

fn emit_conversation_failed(app: &AppHandle, request_id: &str, message: &str) -> Result<(), String> {
    app.emit(
        "conversation_failed",
        ConversationFailedEvent {
            request_id: request_id.to_string(),
            message: message.to_string(),
        },
    )
    .map_err(|e| format!("发送失败事件失败: {e}"))
}

fn streaming_task_info(scenario: &str) -> Vec<TaskMetaItem> {
    vec![
        TaskMetaItem {
            label: "任务 ID".into(),
            value: format!("remote-{}", scenario),
            tone: Some("neutral".into()),
        },
        TaskMetaItem {
            label: "生成时间".into(),
            value: now_text(),
            tone: Some("neutral".into()),
        },
        TaskMetaItem {
            label: "状态".into(),
            value: "远程模型已生成".into(),
            tone: Some("success".into()),
        },
    ]
}

fn build_partial_transcript(content: &str) -> Vec<TranscriptSegment> {
    let rows = match parse_llm_transcript_rows(content) {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };

    rows.into_iter()
        .map(|mut segment| {
            segment.is_partial = Some(true);
            segment
        })
        .collect()
}

fn normalize_final_transcript(transcript: Vec<TranscriptSegment>) -> Vec<TranscriptSegment> {
    transcript
        .into_iter()
        .map(|mut segment| {
            segment.is_partial = Some(false);
            segment
        })
        .collect()
}

fn normalize_llm_speaker(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "assistant" | "sales" | "seller" | "agent" => "sales".into(),
        "user" | "customer" | "client" | "buyer" => "customer".into(),
        other if !other.is_empty() => other.into(),
        _ => String::new(),
    }
}

fn parse_llm_transcript_rows(content: &str) -> Result<Vec<TranscriptSegment>, String> {
    let json_block = extract_json_block(content).unwrap_or_else(|| content.to_string());
    let rows: Vec<LlmTranscriptRow> =
        serde_json::from_str(&json_block).map_err(|e| format!("解析模型输出 JSON 失败: {e}"))?;

    if rows.is_empty() {
        return Err("模型返回的对话为空".into());
    }

    let normalized_rows = rows
        .into_iter()
        .enumerate()
        .map(|(idx, row)| {
            let speaker = transcript_row_speaker(&row);
            let text = transcript_row_text(&row);
            validate_transcript_row(idx, &speaker, &text)?;
            Ok((idx, speaker, text))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let texts = normalized_rows
        .iter()
        .map(|(_, _, text)| text.clone())
        .collect::<Vec<_>>();
    let timings = build_transcript_timing(&texts);

    Ok(normalized_rows
        .into_iter()
        .zip(timings)
        .map(|((idx, speaker, text), (start_time, end_time))| TranscriptSegment {
            id: (idx + 1).to_string(),
            speaker,
            text,
            start_time,
            end_time,
            keywords: None,
            is_partial: None,
        })
        .collect())
}

async fn call_remote_llm(app: &AppHandle, config: &AppConfig, input: &GenerateConversationInput) -> Result<GenerateConversationOutput, String> {
    // 生成链路优先使用本次请求显式传入的 llm_endpoint_id；未传时才回退到默认配置。
    let requested_endpoint_id = input.llm_endpoint_id.as_deref().map(str::trim).filter(|id| !id.is_empty());
    let llm_config = if let Some(endpoint_id) = requested_endpoint_id {
        config
            .llm_endpoints
            .iter()
            .find(|e| e.id == endpoint_id)
            .ok_or_else(|| format!("未找到指定的 LLM 配置: {}", endpoint_id))?
    } else {
        config
            .llm_endpoints
            .iter()
            .find(|e| e.id == config.active_llm_id)
            .or_else(|| config.llm_endpoints.first())
            .ok_or_else(|| "没有可用的 LLM 配置".to_string())?
    };

    let api_key = llm_config.api_key.trim();
    if api_key.is_empty() {
        return Err("未配置 LLM API Key".into());
    }

    let scenario = input.scenario.trim();
    let supplemental_prompt = input
        .supplemental_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if scenario.is_empty() {
        return Err("对话场景不能为空".into());
    }
    if scenario.chars().count() > 500 {
        return Err("对话场景长度不能超过 500 个字符".into());
    }
    if input.rounds < 2 {
        return Err("对话轮数需大于等于 2。".into());
    }
    if let Some(extra) = supplemental_prompt {
        if extra.chars().count() > 1000 {
            return Err("补充要求长度不能超过 1000 个字符".into());
        }
    }

    let request_id = input
        .request_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("conversation-{}", Local::now().timestamp_millis()));
    let raw_system_prompt = input.system_prompt.clone().unwrap_or_else(|| {
        "你是一名资深销售教练。请根据输入生成销售与客户的多轮中文对话。严格返回 JSON 数组，不要额外解释。数组元素格式：{\"speaker\":\"sales|customer\",\"text\":\"...\"}；如果你的模型习惯输出 role/content，也必须确保 role 只使用 sales 或 customer。".into()
    });
    let system_prompt = render_system_prompt_template(&raw_system_prompt, input);

    let supplemental_hint = supplemental_prompt
        .map(|value| format!("\n补充要求：{}", value))
        .unwrap_or_default();

    let user_prompt = format!(
        "对话场景：{}\n轮数：{}{}\n请严格输出 JSON 数组，每轮包含 sales 和 customer 两条发言，内容要自然、口语化，并围绕场景推进到明确的下一步。",
        scenario, input.rounds, supplemental_hint
    );

    let request_payload = build_llm_request_payload(llm_config, &system_prompt, &user_prompt)?;
    let request_log = build_llm_request_log_payload(
        llm_config,
        input,
        &request_id,
        request_payload.protocol,
        &request_payload.url,
        &request_payload.headers,
        &request_payload.body,
    );

    write_backend_log(
        app,
        "info",
        "llm",
        "desktop/src-tauri/src/lib.rs::call_remote_llm",
        "开始请求远程模型",
        Some(request_log),
    );

    emit_conversation_started(app, &request_id, input.rounds)?;

    let client = reqwest::Client::new();
    let response = apply_request_headers(client.post(&request_payload.url), &request_payload.headers)
        .json(&request_payload.body)
        .send()
        .await
        .map_err(|e| format!("请求远程模型失败: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        log_remote_model_failure(app, &llm_config.id, request_payload.protocol, status, &text);
        let failure_message = build_remote_model_error_text(&text);
        let _ = emit_conversation_failed(app, &request_id, &failure_message);
        return Err(failure_message);
    }

    let context = LlmRequestContext {
        app,
        request_id: &request_id,
    };
    let stream_result = consume_llm_stream(&context, response, request_payload.protocol).await?;

    if stream_result.accumulated_content.trim().is_empty() {
        log_unparsed_stream_preview(
            app,
            &llm_config.id,
            request_payload.protocol,
            stream_result.unmatched_frame_preview.clone(),
        );
    }

    maybe_emit_remaining_partial_segments(
        app,
        &request_id,
        &stream_result.accumulated_content,
        stream_result.streamed_segment_count,
    )?;

    let content = stream_result.accumulated_content.trim();
    if content.is_empty() {
        let message = "模型未返回有效内容".to_string();
        let _ = emit_conversation_failed(app, &request_id, &message);
        return Err(message);
    }

    log_raw_model_content(app, &llm_config.id, request_payload.protocol, content);

    let transcript = normalize_final_transcript(parse_llm_transcript_rows(content)?);
    let task_info = streaming_task_info(scenario);

    log_transcript_parse_success(app, &llm_config.id, request_payload.protocol, &transcript);
    emit_conversation_completed(app, &request_id, &transcript, &task_info)?;

    let output = GenerateConversationOutput {
        transcript,
        task_info,
    };
    log_generate_conversation_result(app, &request_id, &output);

    Ok(output)
}

#[tauri::command]
async fn generate_conversation(app: AppHandle, input: GenerateConversationInput) -> Result<GenerateConversationOutput, String> {
    log_generate_conversation_request(&app, &input);
    let workspace = ensure_workspace(&app)?;
    call_remote_llm(&app, &workspace.config, &input).await
}

fn build_export_text(transcript: &[TranscriptSegment], audio_files: &[AudioFileItem]) -> String {
    format!(
        "对话文本\n{}\n\n音频文件\n{}",
        transcript
            .iter()
            .map(|segment| format!("{}: {}", segment.speaker, segment.text))
            .collect::<Vec<_>>()
            .join("\n"),
        audio_files
            .iter()
            .map(|file| format!("{} -> {}", file.title, file.file_path.clone().unwrap_or_default()))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

fn write_zip_file(path: &Path, transcript: &[TranscriptSegment], audio_files: &[AudioFileItem]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 ZIP 目录失败: {e}"))?;
    }

    let file = fs::File::create(path).map_err(|e| format!("创建 ZIP 文件失败: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("conversation.txt", options)
        .map_err(|e| format!("写入对话文件失败: {e}"))?;
    zip.write_all(build_export_text(transcript, audio_files).as_bytes())
        .map_err(|e| format!("写入对话内容失败: {e}"))?;

    for audio in audio_files {
        if let Some(file_path) = &audio.file_path {
            let source = PathBuf::from(file_path);
            if source.exists() {
                let name = format!("audio/{}", audio.file_name);
                zip.start_file(name, options)
                    .map_err(|e| format!("写入音频条目失败: {e}"))?;
                let bytes = fs::read(&source).map_err(|e| format!("读取音频文件失败: {e}"))?;
                zip.write_all(&bytes)
                    .map_err(|e| format!("写入音频 ZIP 内容失败: {e}"))?;
            }
        }
    }

    zip.finish().map_err(|e| format!("完成 ZIP 写入失败: {e}"))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModelItem>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelItem {
    id: String,
}

#[derive(Debug, Deserialize)]
struct QwenTtsResponse {
    file_url: String,
}

#[derive(Debug, Deserialize)]
struct QwenVoicesResponse {
    voices: Vec<String>,
}

#[tauri::command]
async fn list_llm_models(config: AppConfig) -> Result<Vec<SelectOption>, String> {
    let llm_config = config
        .llm_endpoints
        .iter()
        .find(|e| e.id == config.active_llm_id)
        .or_else(|| config.llm_endpoints.first())
        .ok_or_else(|| "没有可用的 LLM 配置".to_string())?;

    let api_key = llm_config.api_key.trim();
    if api_key.is_empty() {
        return Err("未配置 LLM API Key".into());
    }

    let base_url = llm_config.base_url.trim_end_matches('/');
    let url = format!("{}/models", base_url);

    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(CONTENT_TYPE, "application/json")
        .send()
        .await
        .map_err(|e| format!("请求模型列表失败: {e}"))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        if llm_config.provider.trim().eq_ignore_ascii_case("qwen") {
            return Err(format!("千问模型列表接口返回失败: {}。你也可以直接手动填写模型名，例如 qwen-plus、qwen-turbo、qwen-max。", text));
        }
        return Err(format!("模型列表接口返回失败: {}", text));
    }

    let text = response.text().await.map_err(|e| format!("读取响应失败: {e}"))?;

    let payload: OpenAiModelsResponse = match serde_json::from_str(&text) {
        Ok(p) => p,
        Err(e) => {
            let snippet = if text.len() > 200 { format!("{}...", text.chars().take(200).collect::<String>()) } else { text.clone() };
            if llm_config.provider.trim().eq_ignore_ascii_case("qwen") {
                return Err(format!("解析千问模型列表失败: {}\n返回内容: {}\n你可以直接手动填写模型名，例如 qwen-plus、qwen-turbo、qwen-max。", e, snippet));
            }
            return Err(format!("解析模型列表失败: {}\n返回内容: {}", e, snippet));
        }
    };

    let mut models = payload
        .data
        .into_iter()
        .map(|item| SelectOption {
            label: item.id.clone(),
            value: item.id,
            badge: None,
        })
        .collect::<Vec<_>>();

    models.sort_by(|a, b| a.label.cmp(&b.label));

    Ok(models)
}

#[tauri::command]
async fn list_tts_voices(app: AppHandle, config: AppConfig) -> Result<Vec<SelectOption>, String> {
    list_tts_voices_inner(&app, &config).await
}

#[tauri::command]
fn write_log(app: AppHandle, input: FrontendLogInput) -> Result<(), String> {
    write_backend_log(
        &app,
        input.level.trim(),
        input.scope.trim(),
        input.location.as_deref().unwrap_or("frontend"),
        input.message.trim(),
        input.payload,
    );
    Ok(())
}

#[tauri::command]
fn load_workspace(app: AppHandle) -> Result<WorkspaceData, String> {
    write_backend_log(
        &app,
        "info",
        "workspace",
        "desktop/src-tauri/src/lib.rs::load_workspace",
        "开始加载工作区配置",
        Some(format!("db={}", workspace_db_path(&app)?.to_string_lossy())),
    );
    ensure_workspace(&app)
}

#[tauri::command]
async fn save_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let app_for_log = app.clone();
    write_backend_log(
        &app_for_log,
        "info",
        "workspace",
        "desktop/src-tauri/src/lib.rs::save_config",
        "开始保存工作区配置",
        Some(format!(
            "llm_count={} tts_count={} active_llm={} active_tts={} active_prompt={}",
            config.llm_endpoints.len(),
            config.tts_endpoints.len(),
            config.active_llm_id,
            config.active_tts_id,
            config.active_prompt_id
        )),
    );

    let saved = tauri::async_runtime::spawn_blocking(move || -> Result<AppConfig, String> {
        let mut workspace = ensure_workspace(&app)?;
        workspace.config = config.clone();
        ensure_prompt_defaults(&mut workspace);
        save_workspace(&app, &workspace)?;
        Ok(workspace.config)
    })
    .await;
    let saved = match saved {
        Ok(v) => v,
        Err(e) => {
            write_backend_log(
                &app_for_log,
                "error",
                "workspace",
                "desktop/src-tauri/src/lib.rs::save_config",
                "保存工作区配置任务执行失败",
                Some(e.to_string()),
            );
            return Err(format!("保存工作区配置任务执行失败: {e}"));
        }
    };
    let saved = match saved {
        Ok(v) => v,
        Err(e) => {
            write_backend_log(
                &app_for_log,
                "error",
                "workspace",
                "desktop/src-tauri/src/lib.rs::save_config",
                "保存工作区配置失败",
                Some(e.clone()),
            );
            return Err(format!("保存工作区配置失败: {e}"));
        }
    };
    write_backend_log(
        &app_for_log,
        "info",
        "workspace",
        "desktop/src-tauri/src/lib.rs::save_config",
        "保存工作区配置成功",
        Some(format!(
            "llm_count={} tts_count={} active_llm={} active_tts={} active_prompt={}",
            saved.llm_endpoints.len(),
            saved.tts_endpoints.len(),
            saved.active_llm_id,
            saved.active_tts_id,
            saved.active_prompt_id
        )),
    );
    Ok(saved)
}

#[tauri::command]
async fn save_prompts(app: AppHandle, prompts: Vec<PromptTemplate>) -> Result<Vec<PromptTemplate>, String> {
    let app_for_log = app.clone();
    write_backend_log(
        &app_for_log,
        "info",
        "workspace",
        "desktop/src-tauri/src/lib.rs::save_prompts",
        "开始保存 Prompt 模板",
        Some(format!("prompt_count={}", prompts.len())),
    );

    let saved = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<PromptTemplate>, String> {
        let mut workspace = ensure_workspace(&app)?;
        workspace.prompts = prompts;
        ensure_prompt_defaults(&mut workspace);
        save_workspace(&app, &workspace)?;
        Ok(workspace.prompts)
    })
    .await;
    let saved = match saved {
        Ok(v) => v,
        Err(e) => {
            write_backend_log(
                &app_for_log,
                "error",
                "workspace",
                "desktop/src-tauri/src/lib.rs::save_prompts",
                "保存 Prompt 模板任务执行失败",
                Some(e.to_string()),
            );
            return Err(format!("保存 Prompt 模板任务执行失败: {e}"));
        }
    };
    let saved = match saved {
        Ok(v) => v,
        Err(e) => {
            write_backend_log(
                &app_for_log,
                "error",
                "workspace",
                "desktop/src-tauri/src/lib.rs::save_prompts",
                "保存 Prompt 模板失败",
                Some(e.clone()),
            );
            return Err(format!("保存 Prompt 模板失败: {e}"));
        }
    };
    write_backend_log(
        &app_for_log,
        "info",
        "workspace",
        "desktop/src-tauri/src/lib.rs::save_prompts",
        "保存 Prompt 模板成功",
        Some(format!("prompt_count={}", saved.len())),
    );
    Ok(saved)
}

#[tauri::command]
async fn generate_audio(app: AppHandle, input: GenerateAudioInput) -> Result<GenerateAudioOutput, String> {
    write_backend_log(
        &app,
        "info",
        "audio",
        "desktop/src-tauri/src/lib.rs::generate_audio",
        "开始生成音频",
        Some(format!(
            "transcript_size={} audio_dir={}",
            input.transcript.len(),
            input.audio_dir
        )),
    );

    if input.transcript.is_empty() {
        return Err("没有可用于生成音频的对话内容".into());
    }

    let workspace = ensure_workspace(&app)?;
    let config = workspace.config;
    let tts_config = resolve_tts_endpoint(&config, "")?;
    let batch_id = unique_batch_id();
    let data_dir = app_data_dir(&app)?;
    let root_output_dir = ensure_output_dir(&data_dir, &input.audio_dir)?;
    let output_dir = root_output_dir.join(&batch_id);
    fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {e}"))?;

    let segment_extension = audio_file_extension(&tts_config.provider);
    let jobs = input
        .transcript
        .iter()
        .enumerate()
        .map(|(index, segment)| AudioGenerationJob {
            segment_id: format!("audio-segment-{batch_id}-{}", index + 1),
            segment_index: index as u32,
            speaker: segment.speaker.clone(),
            text: segment.text.clone(),
            file_name: format!("task_{:02}_{}.{}", index + 1, segment.speaker, segment_extension),
            file_path: output_dir.join(format!("task_{:02}_{}.{}", index + 1, segment.speaker, segment_extension)),
            attempt_count: 0,
        })
        .collect::<Vec<_>>();

    let task = create_audio_generation_task(
        &app,
        &batch_id,
        &input.audio_dir,
        &tts_config.id,
        &input.transcript,
        &jobs,
    )?;
    let task_state = load_audio_generation_task_state(&app, &task.id)?;
    let process_result = process_audio_generation_task(&app, &config, &task_state, jobs, &output_dir).await?;
    let audio_files = process_result
        .merged_file
        .clone()
        .map(|file| vec![file])
        .unwrap_or_default();

    Ok(GenerateAudioOutput {
        task: process_result.task,
        audio_files,
        merged_file: process_result.merged_file,
    })
}

#[tauri::command]
fn export_zip(app: AppHandle, transcript: Vec<TranscriptSegment>, audio_files: Vec<AudioFileItem>) -> Result<String, String> {
    let data_dir = app_data_dir(&app)?;
    let export_path = data_dir
        .join("exports")
        .join(format!("sales_audio_ai_export_{}.zip", unique_batch_id()));
    let selected = app
        .dialog()
        .file()
        .set_file_name(
            export_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("sales_audio_ai_export.zip"),
        )
        .blocking_save_file();
    let path = selected.ok_or_else(|| "用户取消了保存操作".to_string())?;
    let save_path = path
        .into_path()
        .map_err(|_| "保存路径不是本地文件系统路径".to_string())?;
    write_zip_file(&save_path, &transcript, &audio_files)?;
    Ok(save_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn pick_path(app: AppHandle, kind: String) -> Result<String, String> {
    let dialog = app.dialog().file();
    let picked = if kind == "directory" {
        dialog.blocking_pick_folder()
    } else {
        dialog.blocking_pick_file()
    };
    let path = picked.ok_or_else(|| "用户取消了选择".to_string())?;
    let picked_path = path
        .into_path()
        .map_err(|_| "所选路径不是本地文件系统路径".to_string())?;
    Ok(picked_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_health_status(app: AppHandle) -> Result<HealthStatus, String> {
    write_backend_log(
        &app,
        "info",
        "health",
        "desktop/src-tauri/src/lib.rs::get_health_status",
        "开始检查应用健康状态",
        None,
    );
    let workspace = ensure_workspace(&app)?;
    let audio_dir = ensure_output_dir(&app_data_dir(&app)?, &workspace.config.audio_dir)?;
    let config_file = workspace_db_path(&app)?;

    Ok(HealthStatus {
        system: vec![
            StatusCheckItem {
                label: "系统状态".into(),
                status: "ready".into(),
            },
            StatusCheckItem {
                label: "工作区配置".into(),
                status: if config_file.exists() {
                    "connected"
                } else {
                    "warning"
                }
                .into(),
            },
            StatusCheckItem {
                label: "音频存储目录".into(),
                status: if audio_dir.exists() {
                    "connected"
                } else {
                    "warning"
                }
                .into(),
            },
            StatusCheckItem {
                label: "API 配置状态".into(),
                status: if workspace.config.llm_endpoints.is_empty() || workspace.config.llm_endpoints.iter().find(|e| e.id == workspace.config.active_llm_id).map(|e| e.api_key.is_empty()).unwrap_or(true) {
                    "warning"
                } else {
                    "connected"
                }
                .into(),
            },
        ],
        message: "本地工作区状态已刷新".into(),
    })
}


pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 先初始化应用存储
            initialize_app_storage(&app.handle())
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

            if std::env::var("SALES_AUDIO_AI_DEBUG").map(|v| v == "1").unwrap_or(false) {
                let _ = write_backend_log(
                    &app.handle(),
                    "info",
                    "boot",
                    "desktop/src-tauri/src/lib.rs::run.setup",
                    "Tauri 应用 setup 已执行",
                    None,
                );

                let _ = write_backend_log(
                    &app.handle(),
                    "info",
                    "boot",
                    "devtools",
                    "检测到 SALES_AUDIO_AI_DEBUG=1，已启用 DevTools（使用 Alt+Cmd+I 打开）",
                    None,
                );
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            write_log,
            load_workspace,
            save_config,
            save_prompts,
            list_llm_models,
            list_tts_voices,
            list_audio_files,
            list_audio_generation_tasks,
            update_audio_display_name,
            generate_conversation,
            generate_audio,
            retry_audio_generation_task,
            export_zip,
            pick_path,
            get_health_status,
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
