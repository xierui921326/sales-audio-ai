use chrono::Local;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
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

    #[serde(default = "default_fallback_model")]
    fallback_model: String,
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
struct PromptTemplate {
    id: String,
    title: String,
    description: String,
    system_prompt: String,
    variables: Vec<String>,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScriptEntry {
    id: String,
    speaker: String,
    category: String,
    text: String,
    tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BatchTaskItem {
    id: String,
    title: String,
    industry: String,
    count: u32,
    progress: u32,
    status: String,
    outputs: Vec<String>,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceData {
    config: AppConfig,
    prompts: Vec<PromptTemplate>,
    scripts: Vec<ScriptEntry>,
    tasks: Vec<BatchTaskItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateConversationInput {
    industry: String,
    scenario: String,
    customer_role: String,
    tone: String,
    rounds: u32,
    supplemental_prompt: Option<String>,
    llm_endpoint_id: Option<String>,
    system_prompt: Option<String>,
    scripts: Option<Vec<ScriptEntry>>,
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

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum OpenAiMessageContent {
    Text(String),
    Parts(Vec<OpenAiContentPart>),
}

#[derive(Debug, Deserialize)]
struct OpenAiContentPart {
    #[serde(rename = "type")]
    part_type: Option<String>,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponseMessage {
    content: OpenAiMessageContent,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    temperature: f32,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
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

async fn list_tts_voices_inner(config: &AppConfig) -> Result<Vec<SelectOption>, String> {
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

    println!(
        "[sales-audio-ai][tts] 开始拉取音色列表 endpoint={} provider={}",
        tts_config.id, tts_config.provider
    );

    let response = reqwest::Client::new()
        .get(format!("{}/voices", base_url))
        .send()
        .await
        .map_err(|e| format!("请求音色列表失败: {e}"))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        eprintln!(
            "[sales-audio-ai][tts] 音色列表接口失败 endpoint={} body={}",
            tts_config.id, text
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
    println!(
        "[sales-audio-ai][tts] 音色列表拉取成功 endpoint={} count={}",
        tts_config.id,
        voices.len()
    );
    Ok(voices)
}

fn is_mp3_audio(bytes: &[u8]) -> bool {
    bytes.starts_with(b"ID3") || (bytes.len() >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0)
}

async fn synthesize_audio_bytes(config: &AppConfig, speaker: &str, text: &str) -> Result<Vec<u8>, String> {
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

    println!(
        "[sales-audio-ai][tts] 开始合成音频 endpoint={} provider={} speaker={} text_len={}",
        tts_config.id,
        tts_config.provider,
        speaker,
        text.chars().count()
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

fn merge_mp3_segments_to_wav(path: &Path, chunks: &[Vec<u8>]) -> Result<(), String> {
    if chunks.is_empty() {
        return Err("没有可合并的音频片段".into());
    }

    let mut merged_samples = Vec::new();
    let mut target_spec: Option<hound::WavSpec> = None;

    for chunk in chunks {
        let (spec, samples) = decode_mp3_to_wav_samples(chunk)?;
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
    Ok(conn)
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

fn default_fallback_model() -> String {
    "deepseek-chat".into()
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
        fallback_model: default_fallback_model(),
        audio_dir: default_audio_dir(app)?,
        database_path: resolved_database_path(app)?,
        config_file: resolved_config_file(),
        ..Default::default()
    })
}

fn default_workspace(app: &AppHandle) -> Result<WorkspaceData, String> {
    Ok(WorkspaceData {
        config: default_config(app)?,
        prompts: vec![
            PromptTemplate {
                id: "p1".into(),
                title: "SaaS 首次邀约".into(),
                description: "适用于产品演示邀约场景".into(),
                system_prompt: "你是一名资深销售，需要生成自然、专业、可推进下一步的销售对话。".into(),
                variables: vec!["行业".into(), "场景".into(), "客户角色".into()],
                updated_at: now_text(),
            },
            PromptTemplate {
                id: "p2".into(),
                title: "异议处理模板".into(),
                description: "处理预算、时机与竞品类问题".into(),
                system_prompt: "围绕客户异议给出共情、拆解与下一步推进话术。".into(),
                variables: vec!["异议类型".into(), "目标动作".into()],
                updated_at: now_text(),
            },
        ],
        scripts: vec![
            ScriptEntry {
                id: "s1".into(),
                speaker: "sales".into(),
                category: "开场破冰".into(),
                text: "张总您好，我这边想用一分钟了解一下贵司当前销售跟进流程是否已经标准化。".into(),
                tags: vec!["开场破冰".into(), "需求挖掘".into()],
            },
            ScriptEntry {
                id: "s2".into(),
                speaker: "customer".into(),
                category: "客户回应".into(),
                text: "我们现在主要还是靠表格在跟，效率不高。".into(),
                tags: vec!["现状".into()],
            },
        ],
        tasks: vec![
            BatchTaskItem {
                id: "task-1".into(),
                title: "SaaS 首次邀约批量生成".into(),
                industry: "saas".into(),
                count: 12,
                progress: 8,
                status: "running".into(),
                outputs: vec!["对话文本".into(), "音频脚本".into()],
                created_at: now_text(),
            },
            BatchTaskItem {
                id: "task-2".into(),
                title: "教育行业异议处理脚本".into(),
                industry: "education".into(),
                count: 6,
                progress: 6,
                status: "completed".into(),
                outputs: vec!["对话文本".into(), "合并音频".into()],
                created_at: now_text(),
            },
        ],
    })
}

fn normalize_config_paths(app: &AppHandle, config: &mut AppConfig) -> Result<(), String> {
    if config.audio_dir.trim().is_empty() || config.audio_dir.trim() == "./storage/audio" {
        config.audio_dir = default_audio_dir(app)?;
    }
    config.database_path = resolved_database_path(app)?;
    config.config_file = resolved_config_file();
    Ok(())
}

fn ensure_workspace(app: &AppHandle) -> Result<WorkspaceData, String> {
    if let Some(mut workspace) = load_workspace_from_db(app)? {
        normalize_config_paths(app, &mut workspace.config)?;
        persist_workspace_to_db(app, &workspace)?;
        return Ok(workspace);
    }

    let legacy_path = legacy_workspace_file(app)?;
    if !legacy_path.exists() {
        let workspace = default_workspace(app)?;
        persist_workspace_to_db(app, &workspace)?;
        println!(
            "[sales-audio-ai][workspace] 首次创建 SQLite 工作区 db={}",
            workspace_db_path(app)?.to_string_lossy()
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
        println!(
            "[sales-audio-ai][workspace] 历史工作区已迁移到 SQLite legacy={} db={}",
            legacy_path.to_string_lossy(),
            workspace_db_path(app)?.to_string_lossy()
        );
    }
    persist_workspace_to_db(app, &workspace)?;
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

fn normalize_openai_message_content(content: OpenAiMessageContent) -> String {
    match content {
        OpenAiMessageContent::Text(text) => text,
        OpenAiMessageContent::Parts(parts) => parts
            .into_iter()
            .filter(|part| part.part_type.as_deref().unwrap_or("text") == "text")
            .filter_map(|part| part.text)
            .collect::<Vec<_>>()
            .join("\n"),
    }
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
            })
        })
        .collect()
}

async fn call_remote_llm(config: &AppConfig, input: &GenerateConversationInput) -> Result<GenerateConversationOutput, String> {
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
    if let Some(extra) = supplemental_prompt {
        if extra.chars().count() > 1000 {
            return Err("补充要求长度不能超过 1000 个字符".into());
        }
    }

    let base_url = llm_config.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);
    let system_prompt = input.system_prompt.clone().unwrap_or_else(|| {
        "你是一名资深销售教练。请根据输入生成销售与客户的多轮中文对话。严格返回 JSON 数组，不要额外解释。数组元素格式：{\"speaker\":\"sales|customer\",\"text\":\"...\"}；如果你的模型习惯输出 role/content，也必须确保 role 只使用 sales 或 customer。".into()
    });

    let scripts_hint = input
        .scripts
        .as_ref()
        .map(|rows| {
            let joined = rows
                .iter()
                .take(50)
                .map(|s| format!("- {}: {}", s.speaker, s.text))
                .collect::<Vec<_>>()
                .join("\n");
            format!("\n可参考话术：\n{}\n", joined)
        })
        .unwrap_or_default();

    let supplemental_hint = supplemental_prompt
        .map(|value| format!("\n补充要求：{}", value))
        .unwrap_or_default();

    let user_prompt = format!(
        "对话场景：{}\n轮数：{}{}{}\n请严格输出 JSON 数组，每轮包含 sales 和 customer 两条发言，内容要自然、口语化，并围绕场景推进到明确的下一步。",
        scenario, input.rounds, supplemental_hint, scripts_hint
    );

    let request = OpenAiRequest {
        model: llm_config.model.clone(),
        messages: vec![
            OpenAiMessage {
                role: "system".into(),
                content: system_prompt.into(),
            },
            OpenAiMessage {
                role: "user".into(),
                content: user_prompt,
            },
        ],
        temperature: 0.7,
    };

    println!(
        "[sales-audio-ai][llm] 开始请求远程模型 endpoint={} model={} scenario_len={} rounds={}",
        llm_config.id,
        llm_config.model,
        scenario.chars().count(),
        input.rounds
    );

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(CONTENT_TYPE, "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("请求远程模型失败: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        eprintln!(
            "[sales-audio-ai][llm] 远程模型返回失败 endpoint={} status={} body={}",
            llm_config.id, status, text
        );
        return Err(format!("远程模型返回失败: {}", text));
    }

    let payload: OpenAiResponse = response
        .json()
        .await
        .map_err(|e| format!("解析远程模型响应失败: {e}。请检查当前 LLM 接口是否兼容 OpenAI Chat Completions 返回格式。"))?;
    let content = payload
        .choices
        .into_iter()
        .next()
        .map(|choice| normalize_openai_message_content(choice.message.content))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "远程模型未返回内容".to_string())?;

    println!(
        "[sales-audio-ai][llm] 收到模型原始内容 endpoint={} preview={}",
        llm_config.id,
        content.chars().take(180).collect::<String>()
    );

    let transcript = parse_llm_transcript_rows(&content)?;

    println!(
        "[sales-audio-ai][llm] 对话解析成功 endpoint={} rows={}",
        llm_config.id,
        transcript.len()
    );

    Ok(GenerateConversationOutput {
        transcript,
        task_info: vec![
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
        ],
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
async fn list_tts_voices(config: AppConfig) -> Result<Vec<SelectOption>, String> {
    list_tts_voices_inner(&config).await
}

#[tauri::command]
fn load_workspace(app: AppHandle) -> Result<WorkspaceData, String> {
    println!("[sales-audio-ai][workspace] 收到 load_workspace 请求");
    ensure_workspace(&app)
}

#[tauri::command]
fn save_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    println!(
        "[sales-audio-ai][workspace] 收到 save_config 请求 llm_count={} tts_count={} active_llm={} active_tts={}",
        config.llm_endpoints.len(),
        config.tts_endpoints.len(),
        config.active_llm_id,
        config.active_tts_id
    );
    let mut workspace = ensure_workspace(&app)?;
    workspace.config = config.clone();
    save_workspace(&app, &workspace)?;
    Ok(config)
}

#[tauri::command]
fn save_prompts(app: AppHandle, prompts: Vec<PromptTemplate>) -> Result<Vec<PromptTemplate>, String> {
    let mut workspace = ensure_workspace(&app)?;
    workspace.prompts = prompts.clone();
    save_workspace(&app, &workspace)?;
    Ok(prompts)
}

#[tauri::command]
fn save_scripts(app: AppHandle, scripts: Vec<ScriptEntry>) -> Result<Vec<ScriptEntry>, String> {
    let mut workspace = ensure_workspace(&app)?;
    workspace.scripts = scripts.clone();
    save_workspace(&app, &workspace)?;
    Ok(scripts)
}

#[tauri::command]
fn save_tasks(app: AppHandle, tasks: Vec<BatchTaskItem>) -> Result<Vec<BatchTaskItem>, String> {
    let mut workspace = ensure_workspace(&app)?;
    workspace.tasks = tasks.clone();
    save_workspace(&app, &workspace)?;
    Ok(tasks)
}

#[tauri::command]
async fn generate_conversation(app: AppHandle, input: GenerateConversationInput) -> Result<GenerateConversationOutput, String> {
    println!(
        "[sales-audio-ai][generate] 收到 generate_conversation 请求 rounds={} llm_endpoint_id={}",
        input.rounds,
        input.llm_endpoint_id.clone().unwrap_or_default()
    );
    let workspace = ensure_workspace(&app)?;
    call_remote_llm(&workspace.config, &input).await
}

#[tauri::command]
async fn generate_audio(app: AppHandle, input: GenerateAudioInput) -> Result<GenerateAudioOutput, String> {
    println!(
        "[sales-audio-ai][audio] 收到 generate_audio 请求 transcript_size={} audio_dir={}",
        input.transcript.len(),
        input.audio_dir
    );
    let workspace = ensure_workspace(&app)?;
    let config = workspace.config;
    let data_dir = app_data_dir(&app)?;
    let output_dir = ensure_output_dir(&data_dir, &input.audio_dir)?;
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
        match synthesize_audio_bytes(&config, &segment.speaker, &segment.text).await {
            Ok(bytes) => {
                merged_chunks.push(bytes);
                used_real_tts = true;
                println!(
                    "[sales-audio-ai][audio] 音频片段合成成功 index={} provider={} ext={}",
                    index + 1,
                    tts_config.provider,
                    segment_extension
                );
            }
            Err(error) => {
                eprintln!(
                    "[sales-audio-ai][audio] 在线 TTS 失败，终止合并 index={} error={}",
                    index + 1,
                    error
                );
                return Err(error);
            }
        }
    }

    if !used_real_tts || merged_chunks.is_empty() {
        return Err("未生成任何可用音频片段，请检查当前 TTS 配置后重试。".into());
    }

    let merged_extension = if merged_chunks.iter().all(|chunk| is_mp3_audio(chunk)) {
        "wav"
    } else {
        segment_extension
    };
    let merged_name = format!("merged_task.{}", merged_extension);
    let merged_path = output_dir.join(&merged_name);
    let merged_text = input
        .transcript
        .iter()
        .map(|segment| format!("{}: {}", segment.speaker, segment.text))
        .collect::<Vec<_>>()
        .join("\n");

    if merged_chunks.iter().all(|chunk| is_mp3_audio(chunk)) {
        merge_mp3_segments_to_wav(&merged_path, &merged_chunks)?;
    } else if merged_chunks.len() == 1 {
        fs::write(&merged_path, &merged_chunks[0]).map_err(|e| format!("写入合并音频失败: {e}"))?;
    } else {
        return Err("当前 TTS 返回的音频格式暂不支持多片段直接合并，请改用 OpenAI / ElevenLabs，或减少为单句后再试。".into());
    }

    println!(
        "[sales-audio-ai][audio] 合并音频输出完成 provider={} ext={} path={}",
        tts_config.provider,
        merged_extension,
        merged_path.to_string_lossy()
    );

    let merged_file = AudioFileItem {
        id: format!("audio-merged-{}", Local::now().timestamp()),
        role: "merged".into(),
        title: merged_audio_title(),
        file_name: merged_name,
        duration: format!("00:{:02}", (input.transcript.len() as u32 * 4).min(59)),
        file_path: Some(merged_path.to_string_lossy().to_string()),
        text: Some(merged_text),
    };

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
    println!("[sales-audio-ai][health] 收到 get_health_status 请求");
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
            load_workspace,
            save_config,
            save_prompts,
            save_scripts,
            save_tasks,
            list_llm_models,
            list_tts_voices,
            generate_conversation,
            generate_audio,
            export_zip,
            save_zip_as,
            pick_path,
            get_health_status,
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
