export type RecordingState = 'idle' | 'recording' | 'processing' | 'done';
export type NavigationItemId =
    | 'generate'
    | 'audio'
    | 'llm'
    | 'tts';

export interface TranscriptSegment {
    id: string;
    speaker: 'sales' | 'customer';
    text: string;
    startTime: number;
    endTime: number;
    keywords?: string[];
}

export interface ScoreItem {
    label: string;
    score: number;
    maxScore: number;
    comment: string;
}

export interface AnalysisResult {
    totalScore: number;
    scores: ScoreItem[];
    suggestions: string[];
    highlights: string[];
    summary: string;
}

export interface SelectOption {
    label: string;
    value: string;
    badge?: string;
}

export interface ConversationParameter {
    id: string;
    label: string;
    type: 'select' | 'textarea' | 'number';
    value: string;
    options?: SelectOption[];
    helper?: string;
    placeholder?: string;
}

export interface TaskMetaItem {
    label: string;
    value: string;
    tone?: 'success' | 'info' | 'neutral' | 'warning';
}

export interface AudioFileItem {
    id: string;
    role: 'sales' | 'customer' | 'merged';
    title: string;
    fileName: string;
    duration: string;
    filePath?: string;
    text?: string;
}

export interface StatusCheckItem {
    label: string;
    status: 'ready' | 'connected' | 'warning';
}

export interface ConfigField {
    id: string;
    label: string;
    value: string;
    placeholder?: string;
    helper?: string;
    masked?: boolean;
    actionLabel?: string;
}

export interface ProviderOption extends SelectOption {
    description?: string;
}

export interface ModelOption {
    label: string;
    value: string;
    tag?: string;
}

export interface VoiceRoleOption {
    label: string;
    value: string;
    accent?: string;
    gender?: string;
}

export interface LlmEndpointConfig {
    id: string;
    title: string;
    provider: string;
    apiKey: string;
    baseUrl: string;
    model: string;
}

export interface TtsEndpointConfig {
    id: string;
    title: string;
    provider: string;
    apiKey: string;
    baseUrl: string;
    ttsModel: string;
    salesVoice: string;
    customerVoice: string;
}

export interface AppConfig {
    activeLlmId: string;
    llmEndpoints: LlmEndpointConfig[];
    activeTtsId: string;
    ttsEndpoints: TtsEndpointConfig[];
    
    fallbackModel: string;
    audioDir: string;
    databasePath: string;
    configFile: string;

    // 保留旧字段用于向后兼容的类型定义安全
    llmProvider?: string;
    llmApiKey?: string;
    llmBaseUrl?: string;
    llmModel?: string;
    ttsProvider?: string;
    ttsApiKey?: string;
    ttsModel?: string;
    ttsBaseUrl?: string;
    salesVoice?: string;
    customerVoice?: string;
}

export interface PromptTemplate {
    id: string;
    title: string;
    description: string;
    systemPrompt: string;
    variables: string[];
    updatedAt: string;
}

export interface ScriptEntry {
    id: string;
    speaker: 'sales' | 'customer';
    category: string;
    text: string;
    tags: string[];
}

export interface BatchTaskItem {
    id: string;
    title: string;
    industry: string;
    count: number;
    progress: number;
    status: 'pending' | 'running' | 'completed';
    outputs: string[];
    createdAt: string;
}

export interface WorkspaceData {
    config: AppConfig;
    prompts: PromptTemplate[];
    scripts: ScriptEntry[];
    tasks: BatchTaskItem[];
}

export interface GenerateConversationInput {
    industry: string;
    scenario: string;
    customerRole: string;
    tone: string;
    rounds: number;
    systemPrompt?: string;
    scripts?: ScriptEntry[];
}

export interface GenerateConversationOutput {
    transcript: TranscriptSegment[];
    taskInfo: TaskMetaItem[];
    analysis: AnalysisResult;
}

export interface GenerateAudioInput {
    transcript: TranscriptSegment[];
    salesVoice: string;
    customerVoice: string;
    audioDir: string;
}

export interface GenerateAudioOutput {
    audioFiles: AudioFileItem[];
    mergedFile: AudioFileItem;
}

export interface HealthStatus {
    system: StatusCheckItem[];
    message: string;
}
