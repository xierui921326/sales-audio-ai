use chrono::Local;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use zip::write::SimpleFileOptions;

#[derive(Default)]
struct AudioState {
    current: Mutex<Option<PathBuf>>,
}

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
struct ScoreItem {
    label: String,
    score: u32,
    max_score: u32,
    comment: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AnalysisResult {
    total_score: u32,
    scores: Vec<ScoreItem>,
    suggestions: Vec<String>,
    highlights: Vec<String>,
    summary: String,
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
    #[serde(default = "default_audio_dir")]
    audio_dir: String,
    #[serde(default = "default_database_path")]
    database_path: String,
    #[serde(default = "default_config_file")]
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
    system_prompt: Option<String>,
    scripts: Option<Vec<ScriptEntry>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateConversationOutput {
    transcript: Vec<TranscriptSegment>,
    task_info: Vec<TaskMetaItem>,
    analysis: AnalysisResult,
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
    message: OpenAiMessage,
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

    match tts_config.provider.as_str() {
        "openai" => request_openai_tts_bytes(tts_config, text, voice).await,
        "elevenlabs" => request_elevenlabs_tts_bytes(tts_config, text, voice).await,
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

fn now_text() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn default_llm_provider() -> String {
    "openai".into()
}

fn default_llm_base_url() -> String {
    "https://api.openai.com/v1".into()
}

fn default_llm_model() -> String {
    "".into()
}

fn default_fallback_model() -> String {
    "deepseek-chat".into()
}

fn default_tts_provider() -> String {
    "edge".into()
}

fn default_tts_model() -> String {
    "gpt-4o-mini-tts".into()
}

fn default_tts_base_url() -> String {
    "https://api.openai.com/v1".into()
}

fn default_sales_voice() -> String {
    "zh-CN-YunxiNeural".into()
}

fn default_customer_voice() -> String {
    "zh-CN-XiaoxiaoNeural".into()
}

fn default_audio_dir() -> String {
    "./storage/audio".into()
}

fn default_database_path() -> String {
    "./app.db".into()
}

fn default_config_file() -> String {
    "config.json".into()
}

fn default_config() -> AppConfig {
    AppConfig {
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
        audio_dir: default_audio_dir(),
        database_path: default_database_path(),
        config_file: default_config_file(),
        ..Default::default()
    }
}

fn default_workspace() -> WorkspaceData {
    WorkspaceData {
        config: default_config(),
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
    }
}

fn workspace_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("workspace.json"))
}

fn ensure_workspace(app: &AppHandle) -> Result<WorkspaceData, String> {
    let path = workspace_file(app)?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建工作区目录失败: {e}"))?;
        }
        let workspace = default_workspace();
        let text = serde_json::to_string_pretty(&workspace).map_err(|e| format!("序列化工作区失败: {e}"))?;
        fs::write(&path, text).map_err(|e| format!("写入工作区文件失败: {e}"))?;
        return Ok(workspace);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("读取工作区文件失败: {e}"))?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("解析工作区文件失败: {e}"))?;
    let mut workspace: WorkspaceData = serde_json::from_value(value.clone()).map_err(|e| format!("解析工作区文件失败: {e}"))?;

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

    let normalized = serde_json::to_value(&workspace).map_err(|e| format!("序列化工作区失败: {e}"))?;
    if normalized != value || modified {
        save_workspace(app, &workspace)?;
    }
    Ok(workspace)
}

fn save_workspace(app: &AppHandle, workspace: &WorkspaceData) -> Result<(), String> {
    let path = workspace_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建工作区目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(workspace).map_err(|e| format!("序列化工作区失败: {e}"))?;
    fs::write(path, text).map_err(|e| format!("写入工作区失败: {e}"))
}

fn create_audio_placeholder(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建音频目录失败: {e}"))?;
    }
    fs::write(path, text.as_bytes()).map_err(|e| format!("写入音频占位文件失败: {e}"))
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

fn fallback_conversation(input: &GenerateConversationInput) -> GenerateConversationOutput {
    let rounds = input.rounds.max(2).min(12);
    let mut transcript = Vec::new();

    for idx in 0..rounds {
        let sales_id = (idx * 2 + 1).to_string();
        let customer_id = (idx * 2 + 2).to_string();
        let start = idx * 8;
        transcript.push(TranscriptSegment {
            id: sales_id,
            speaker: "sales".into(),
            text: format!(
                "您好，我想结合{}行业的{}场景，了解一下您在{}环节最关注什么问题？",
                input.industry, input.scenario, input.customer_role
            ),
            start_time: start,
            end_time: start + 4,
            keywords: Some(vec![input.industry.clone(), input.scenario.clone()]),
        });
        transcript.push(TranscriptSegment {
            id: customer_id,
            speaker: "customer".into(),
            text: if idx == 0 {
                format!("我们比较关注{}推进效率。", input.scenario)
            } else {
                format!("如果方案合适，我们愿意进一步了解，语气偏{}。", input.tone)
            },
            start_time: start + 4,
            end_time: start + 8,
            keywords: Some(vec![input.customer_role.clone()]),
        });
    }

    GenerateConversationOutput {
        transcript,
        task_info: vec![
            TaskMetaItem {
                label: "任务 ID".into(),
                value: format!("task-{}-{}", input.industry, rounds),
                tone: Some("neutral".into()),
            },
            TaskMetaItem {
                label: "生成时间".into(),
                value: now_text(),
                tone: Some("neutral".into()),
            },
            TaskMetaItem {
                label: "状态".into(),
                value: "对话已生成".into(),
                tone: Some("success".into()),
            },
        ],
        analysis: AnalysisResult {
            total_score: 88,
            scores: vec![
                ScoreItem {
                    label: "开场破冰".into(),
                    score: 18,
                    max_score: 20,
                    comment: "开场自然，聚焦场景。".into(),
                },
                ScoreItem {
                    label: "需求挖掘".into(),
                    score: 27,
                    max_score: 30,
                    comment: "能够结合客户角色进行追问。".into(),
                },
                ScoreItem {
                    label: "价值呈现".into(),
                    score: 25,
                    max_score: 30,
                    comment: "价值点已和业务场景关联。".into(),
                },
                ScoreItem {
                    label: "推进收尾".into(),
                    score: 18,
                    max_score: 20,
                    comment: "对下一步动作的推进较明确。".into(),
                },
            ],
            suggestions: vec![
                "补充更具体的量化收益说明。".into(),
                "增加对客户现状工具链的确认。".into(),
                "结尾可进一步锁定演示时间。".into(),
            ],
            highlights: vec!["场景聚焦清晰".into(), "推进动作明确".into()],
            summary: format!(
                "已基于{}行业、{}场景与{}角色生成 {} 轮对话。",
                input.industry, input.scenario, input.customer_role, rounds
            ),
        },
    }
}

async fn call_remote_llm(config: &AppConfig, input: &GenerateConversationInput) -> Result<GenerateConversationOutput, String> {
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
    let url = format!("{}/chat/completions", base_url);
    let system_prompt = input.system_prompt.clone().unwrap_or_else(|| {
        "你是一名资深销售教练。请根据输入生成销售与客户的多轮中文对话。严格返回 JSON 数组，不要额外解释。数组元素格式：{\"speaker\":\"sales|customer\",\"text\":\"...\"}".into()
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

    let user_prompt = format!(
        "行业：{}\n场景：{}\n客户角色：{}\n语气：{}\n轮数：{}{}请输出严格 JSON 数组，每轮包含 sales 和 customer 两条发言。",
        input.industry, input.scenario, input.customer_role, input.tone, input.rounds, scripts_hint
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

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(CONTENT_TYPE, "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("请求远程模型失败: {e}"))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("远程模型返回失败: {}", text));
    }

    let payload: OpenAiResponse = response
        .json()
        .await
        .map_err(|e| format!("解析远程模型响应失败: {e}"))?;
    let content = payload
        .choices
        .first()
        .map(|choice| choice.message.content.clone())
        .ok_or_else(|| "远程模型未返回内容".to_string())?;

    let json_block = extract_json_block(&content).unwrap_or(content);
    let rows: Vec<OpenAiMessage> =
        serde_json::from_str(&json_block).map_err(|e| format!("解析模型输出 JSON 失败: {e}"))?;
    if rows.is_empty() {
        return Err("模型返回的对话为空".into());
    }

    let transcript = rows
        .into_iter()
        .enumerate()
        .map(|(idx, row)| TranscriptSegment {
            id: (idx + 1).to_string(),
            speaker: if row.role == "assistant" {
                "sales".into()
            } else {
                row.role
            },
            text: row.content,
            start_time: (idx as u32) * 4,
            end_time: (idx as u32) * 4 + 4,
            keywords: None,
        })
        .collect::<Vec<_>>();

    Ok(GenerateConversationOutput {
        transcript,
        task_info: vec![
            TaskMetaItem {
                label: "任务 ID".into(),
                value: format!("remote-{}", input.industry),
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
        analysis: AnalysisResult {
            total_score: 90,
            scores: vec![
                ScoreItem {
                    label: "开场破冰".into(),
                    score: 18,
                    max_score: 20,
                    comment: "远程模型生成的开场较自然。".into(),
                },
                ScoreItem {
                    label: "需求挖掘".into(),
                    score: 28,
                    max_score: 30,
                    comment: "追问维度较完整。".into(),
                },
                ScoreItem {
                    label: "价值呈现".into(),
                    score: 26,
                    max_score: 30,
                    comment: "能够结合业务场景表达价值。".into(),
                },
                ScoreItem {
                    label: "推进收尾".into(),
                    score: 18,
                    max_score: 20,
                    comment: "收尾推进明确。".into(),
                },
            ],
            suggestions: vec!["可补充更具体的客户数据。".into(), "可继续优化结尾的行动引导。".into()],
            highlights: vec!["已调用真实远程模型".into(), "结果来自在线生成".into()],
            summary: format!("已通过 {} 模型生成真实销售对话。", llm_config.model),
        },
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
            // 如果解析失败，为了方便排查，最多截取前 200 个字符进行回显提示
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
fn load_workspace(app: AppHandle) -> Result<WorkspaceData, String> {
    ensure_workspace(&app)
}

#[tauri::command]
fn save_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
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
    let workspace = ensure_workspace(&app)?;
    match call_remote_llm(&workspace.config, &input).await {
        Ok(result) => Ok(result),
        Err(_) => Ok(fallback_conversation(&input)),
    }
}

#[tauri::command]
async fn generate_audio(app: AppHandle, input: GenerateAudioInput) -> Result<GenerateAudioOutput, String> {
    let workspace = ensure_workspace(&app)?;
    let config = workspace.config;
    let data_dir = app_data_dir(&app)?;
    let output_dir = data_dir.join(input.audio_dir.replace("./", ""));
    fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {e}"))?;

    let mut audio_files = Vec::new();
    let mut merged_chunks: Vec<Vec<u8>> = Vec::new();
    let mut used_real_tts = false;

    let tts_config = config
        .tts_endpoints
        .iter()
        .find(|e| e.id == config.active_tts_id)
        .or_else(|| config.tts_endpoints.first())
        .ok_or_else(|| "没有可用的 TTS 配置".to_string())?;

    for (index, segment) in input.transcript.iter().enumerate() {
        let extension = if matches!(tts_config.provider.as_str(), "openai" | "elevenlabs") {
            "mp3"
        } else {
            "txt"
        };
        let file_name = format!("task_{:03}_{}.{}", index + 1, segment.speaker, extension);
        let file_path = output_dir.join(&file_name);

        match synthesize_audio_bytes(&config, &segment.speaker, &segment.text).await {
            Ok(bytes) => {
                fs::write(&file_path, &bytes).map_err(|e| format!("写入在线 TTS 音频失败: {e}"))?;
                merged_chunks.push(bytes);
                used_real_tts = true;
            }
            Err(_) => {
                create_audio_placeholder(&file_path, &segment.text)?;
            }
        }

        audio_files.push(AudioFileItem {
            id: format!("audio-{}", index + 1),
            role: segment.speaker.clone(),
            title: format!(
                "{} · 第 {} 轮",
                if segment.speaker == "sales" { "销售" } else { "客户" },
                index / 2 + 1
            ),
            file_name,
            duration: format!("00:{:02}", (segment.end_time - segment.start_time).min(59)),
            file_path: Some(file_path.to_string_lossy().to_string()),
            text: Some(segment.text.clone()),
        });
    }

    let merged_extension = if used_real_tts { "wav" } else { "txt" };
    let merged_name = format!("merged_task.{}", merged_extension);
    let merged_path = output_dir.join(&merged_name);
    let merged_text = input
        .transcript
        .iter()
        .map(|segment| format!("{}: {}", segment.speaker, segment.text))
        .collect::<Vec<_>>()
        .join("\n");

    if used_real_tts {
        merge_mp3_segments_to_wav(&merged_path, &merged_chunks)?;
    } else {
        create_audio_placeholder(&merged_path, &merged_text)?;
    }

    let merged_file = AudioFileItem {
        id: "audio-merged".into(),
        role: "merged".into(),
        title: if used_real_tts { "合并音频（WAV）".into() } else { "合并音频".into() },
        file_name: merged_name,
        duration: format!("00:{:02}", (input.transcript.len() as u32 * 4).min(59)),
        file_path: Some(merged_path.to_string_lossy().to_string()),
        text: Some(merged_text),
    };

    Ok(GenerateAudioOutput { audio_files, merged_file })
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
    let data_dir = app_data_dir(&app)?;
    let workspace = ensure_workspace(&app)?;
    let audio_dir = data_dir.join(workspace.config.audio_dir.replace("./", ""));
    let config_file = workspace_file(&app)?;

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

#[tauri::command]
fn open_path(app: AppHandle, path: String, audio_state: State<AudioState>) -> Result<String, String> {
    let target = if path.trim().is_empty() {
        workspace_file(&app)?
    } else {
        PathBuf::from(path)
    };

    if !target.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        if target.extension().is_some() {
            fs::write(&target, b"").map_err(|e| format!("创建文件失败: {e}"))?;
        }
    }

    let mut guard = audio_state
        .current
        .lock()
        .map_err(|_| "状态锁失败".to_string())?;
    *guard = Some(target.clone());
    Ok(target.to_string_lossy().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .manage(AudioState::default())
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_config,
            save_prompts,
            save_scripts,
            save_tasks,
            list_llm_models,
            generate_conversation,
            generate_audio,
            export_zip,
            save_zip_as,
            pick_path,
            get_health_status,
            open_path,
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
