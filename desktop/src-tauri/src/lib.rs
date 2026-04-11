use chrono::Local;
use futures_util::StreamExt;
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
    duration: String,
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
    audio_files: Vec<AudioFileItem>,
    merged_file: AudioFileItem,
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
        if provider.trim().eq_ignore_ascii_case("anthropic") {
            Self::AnthropicMessages
        } else {
            Self::OpenAiCompatible
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
const RAW_CONTENT_PREVIEW_LIMIT: usize = 180;

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

async fn synthesize_audio_bytes(app: &AppHandle, config: &AppConfig, speaker: &str, text: &str) -> Result<Vec<u8>, String> {
    let tts_config = config
        .tts_endpoints
        .iter()
        .find(|e| e.id == config.active_tts_id)
        .or_else(|| config.tts_endpoints.first())
        .ok_or_else(|| "没有可用的 TTS 配置".to_string())?;

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
    let payload_text = payload.as_deref();
    let payload_suffix = payload_text
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" | {}", value))
        .unwrap_or_default();
    let console_line = format!(
        "[sales-audio-ai][{}][{}][{}][{}] {}{}",
        format_log_timestamp(),
        level,
        normalized_scope,
        normalized_location,
        message,
        payload_suffix
    );
    match level {
        "error" => eprintln!("{}", console_line),
        "warn" => eprintln!("{}", console_line),
        _ => println!("{}", console_line),
    }

    if let Err(error) = append_local_log(app, level, &normalized_scope, Some(&normalized_location), message, payload_text) {
        eprintln!("[sales-audio-ai][{}][error][backend:logger][desktop/src-tauri/src/lib.rs] 写入本地日志失败 | {}", format_log_timestamp(), error);
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
            file_path TEXT NOT NULL,
            duration TEXT NOT NULL DEFAULT '',
            text TEXT,
            created_at TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("初始化音频记录表失败: {e}"))?;
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
            id, batch_id, role, title, file_name, file_path, duration, text, created_at
        ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            audio.id,
            batch_id,
            audio.role,
            audio.title,
            audio.file_name,
            audio.file_path.clone().unwrap_or_default(),
            audio.duration,
            audio.text,
            now_text(),
        ],
    )
    .map_err(|e| format!("写入音频记录失败: {e}"))?;
    Ok(())
}

fn load_audio_records(app: &AppHandle) -> Result<Vec<AudioFileItem>, String> {
    let conn = open_workspace_db(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, role, title, file_name, file_path, duration, text
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
                file_path: Some(row.get::<_, String>(4)?),
                duration: row.get(5)?,
                text: row.get(6)?,
            })
        })
        .map_err(|e| format!("读取音频记录失败: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("解析音频记录失败: {e}"))
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
        audio_dir: default_audio_dir(app)?,
        database_path: resolved_database_path(app)?,
        config_file: resolved_config_file(),
        ..Default::default()
    })
}

fn default_workspace(app: &AppHandle) -> Result<WorkspaceData, String> {
    Ok(WorkspaceData {
        config: default_config(app)?,
    })
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
        normalize_config_paths(app, &mut workspace.config)?;
        persist_workspace_to_db(app, &workspace)?;
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

fn preview_text(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
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
        Some(format!(
            "endpoint={} protocol={} status={} body={}",
            endpoint_id,
            protocol_name(protocol),
            status,
            text
        )),
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
            format!(
                "endpoint={} protocol={} frame={}",
                endpoint_id,
                protocol_name(protocol),
                preview
            )
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
        Some(format!(
            "endpoint={} protocol={} preview={}",
            endpoint_id,
            protocol_name(protocol),
            preview_text(content, RAW_CONTENT_PREVIEW_LIMIT)
        )),
    );
}

fn log_transcript_parse_success(app: &AppHandle, endpoint_id: &str, protocol: LlmStreamProtocol, row_count: usize) {
    write_backend_log(
        app,
        "info",
        "llm",
        "desktop/src-tauri/src/lib.rs::call_remote_llm",
        "对话解析成功",
        Some(format!(
            "endpoint={} protocol={} rows={}",
            endpoint_id,
            protocol_name(protocol),
            row_count
        )),
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
    scenario_len: usize,
    rounds: u32,
    request_id: &str,
    protocol: LlmStreamProtocol,
    url: &str,
) -> String {
    format!(
        "endpoint={} provider={} protocol={} url={} model={} scenario_len={} rounds={} request_id={}",
        llm_config.id,
        llm_config.provider,
        protocol_name(protocol),
        url,
        llm_config.model,
        scenario_len,
        rounds,
        request_id
    )
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

    rows.into_iter()
        .enumerate()
        .map(|(idx, row)| {
            let speaker = if !row.speaker.trim().is_empty() {
                normalize_llm_speaker(&row.speaker)
            } else {
                normalize_llm_speaker(&row.role)
            };
            let text = if !row.text.trim().is_empty() {
                row.text.trim().to_string()
            } else {
                row.content.trim().to_string()
            };

            if speaker != "sales" && speaker != "customer" {
                return Err(format!("第 {} 条对话缺少合法 speaker/role 字段", idx + 1));
            }
            if text.is_empty() {
                return Err(format!("第 {} 条对话缺少 text/content 字段", idx + 1));
            }

            Ok(TranscriptSegment {
                id: (idx + 1).to_string(),
                speaker,
                text,
                start_time: (idx as u32) * 4,
                end_time: (idx as u32) * 4 + 4,
                keywords: None,
                is_partial: None,
            })
        })
        .collect()
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
    let system_prompt = input.system_prompt.clone().unwrap_or_else(|| {
        "你是一名资深销售教练。请根据输入生成销售与客户的多轮中文对话。严格返回 JSON 数组，不要额外解释。数组元素格式：{\"speaker\":\"sales|customer\",\"text\":\"...\"}；如果你的模型习惯输出 role/content，也必须确保 role 只使用 sales 或 customer。".into()
    });

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
        scenario.chars().count(),
        input.rounds,
        &request_id,
        request_payload.protocol,
        &request_payload.url,
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

    log_transcript_parse_success(app, &llm_config.id, request_payload.protocol, transcript.len());
    emit_conversation_completed(app, &request_id, &transcript, &task_info)?;

    Ok(GenerateConversationOutput {
        transcript,
        task_info,
    })
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
        return Err(format!("模型列表接口返回失败: {}", text));
    }

    let text = response.text().await.map_err(|e| format!("读取响应失败: {e}"))?;

    let payload: OpenAiModelsResponse = match serde_json::from_str(&text) {
        Ok(p) => p,
        Err(e) => {
            let snippet = if text.len() > 200 { format!("{}...", text.chars().take(200).collect::<String>()) } else { text.clone() };
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
fn save_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    write_backend_log(
        &app,
        "info",
        "workspace",
        "desktop/src-tauri/src/lib.rs::save_config",
        "开始保存工作区配置",
        Some(format!(
            "llm_count={} tts_count={} active_llm={} active_tts={}",
            config.llm_endpoints.len(),
            config.tts_endpoints.len(),
            config.active_llm_id,
            config.active_tts_id
        )),
    );
    let mut workspace = ensure_workspace(&app)?;
    workspace.config = config.clone();
    save_workspace(&app, &workspace)?;
    Ok(config)
}

#[tauri::command]
async fn generate_conversation(app: AppHandle, input: GenerateConversationInput) -> Result<GenerateConversationOutput, String> {
    write_backend_log(
        &app,
        "info",
        "generate",
        "desktop/src-tauri/src/lib.rs::generate_conversation",
        "开始生成对话",
        Some(format!(
            "rounds={} llm_endpoint_id={}",
            input.rounds,
            input.llm_endpoint_id.clone().unwrap_or_default()
        )),
    );
    let workspace = ensure_workspace(&app)?;
    call_remote_llm(&app, &workspace.config, &input).await
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
    let workspace = ensure_workspace(&app)?;
    let config = workspace.config;
    let data_dir = app_data_dir(&app)?;
    let root_output_dir = ensure_output_dir(&data_dir, &input.audio_dir)?;
    let batch_id = unique_batch_id();
    let output_dir = root_output_dir.join(&batch_id);
    fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {e}"))?;

    let mut merged_chunks: Vec<Vec<u8>> = Vec::new();
    let mut used_real_tts = false;

    let tts_config = config
        .tts_endpoints
        .iter()
        .find(|e| e.id == config.active_tts_id)
        .or_else(|| config.tts_endpoints.first())
        .ok_or_else(|| "没有可用的 TTS 配置".to_string())?;

    let segment_extension = audio_file_extension(&tts_config.provider);

    // 仍然逐句合成，便于后端按顺序拼接，但音频页只展示最终合并文件。
    for (index, segment) in input.transcript.iter().enumerate() {
        match synthesize_audio_bytes(&app, &config, &segment.speaker, &segment.text).await {
            Ok(bytes) => {
                let segment_name = format!("task_{:02}_{}.{}", index + 1, segment.speaker, segment_extension);
                let segment_path = output_dir.join(&segment_name);
                fs::write(&segment_path, &bytes).map_err(|e| format!("写入音频片段失败: {e}"))?;
                merged_chunks.push(bytes);
                used_real_tts = true;
                write_backend_log(
                    &app,
                    "info",
                    "audio",
                    "desktop/src-tauri/src/lib.rs::generate_audio",
                    "音频片段合成成功",
                    Some(format!(
                        "index={} provider={} ext={} path={}",
                        index + 1,
                        tts_config.provider,
                        segment_extension,
                        segment_path.to_string_lossy()
                    )),
                );
            }
            Err(error) => {
                write_backend_log(
                    &app,
                    "error",
                    "audio",
                    "desktop/src-tauri/src/lib.rs::generate_audio",
                    "在线 TTS 失败，终止合并",
                    Some(format!("index={} error={}", index + 1, error)),
                );
                return Err(error);
            }
        }
    }

    if !used_real_tts || merged_chunks.is_empty() {
        return Err("未生成任何可用音频片段，请检查当前 TTS 配置后重试。".into());
    }

    // 合并文件名带 batch_id，避免重复生成时覆盖历史音频。
    let merged_name = format!("merged_{}.wav", batch_id);
    let merged_path = output_dir.join(&merged_name);
    let merged_text = input
        .transcript
        .iter()
        .map(|segment| format!("{}: {}", segment.speaker, segment.text))
        .collect::<Vec<_>>()
        .join("\n");

    merge_audio_segments_to_wav(&merged_path, &merged_chunks)?;

    write_backend_log(
        &app,
        "info",
        "audio",
        "desktop/src-tauri/src/lib.rs::generate_audio",
        "合并音频输出完成",
        Some(format!("provider={} ext=wav path={}", tts_config.provider, merged_path.to_string_lossy())),
    );

    let merged_file = AudioFileItem {
        id: format!("audio-merged-{}", batch_id),
        role: "merged".into(),
        title: merged_audio_title(),
        file_name: merged_name,
        duration: format!("00:{:02}", (input.transcript.len() as u32 * 4).min(59)),
        file_path: Some(merged_path.to_string_lossy().to_string()),
        text: Some(merged_text),
    };

    persist_audio_record(&app, &batch_id, &merged_file)?;

    Ok(GenerateAudioOutput {
        audio_files: vec![merged_file.clone()],
        merged_file,
    })
}

#[tauri::command]
fn export_zip(app: AppHandle, transcript: Vec<TranscriptSegment>, audio_files: Vec<AudioFileItem>) -> Result<String, String> {
    let data_dir = app_data_dir(&app)?;
    let export_path = data_dir
        .join("exports")
        .join(format!("sales_audio_ai_export_{}.zip", Local::now().timestamp()));
    write_zip_file(&export_path, &transcript, &audio_files)?;
    Ok(export_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn save_zip_as(app: AppHandle, transcript: Vec<TranscriptSegment>, audio_files: Vec<AudioFileItem>) -> Result<String, String> {
    let data_dir = app_data_dir(&app)?;
    let default_path = data_dir.join("exports").join("sales_audio_ai_export.zip");
    let selected = app
        .dialog()
        .file()
        .set_file_name(
            default_path
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
        .invoke_handler(tauri::generate_handler![
            write_log,
            load_workspace,
            save_config,
            list_llm_models,
            list_tts_voices,
            list_audio_files,
            generate_conversation,
            generate_audio,
            export_zip,
            save_zip_as,
            pick_path,
            get_health_status,
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
