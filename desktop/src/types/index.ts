export type RecordingState = 'idle' | 'recording' | 'processing' | 'done';
export type NavigationItemId =
    | 'generate'
    | 'tasks'
    | 'audio'
    | 'llm'
    | 'tts'
    | 'prompt';

export interface TranscriptSegment {
    id: string;
    speaker: 'sales' | 'customer';
    text: string;
    startTime: number;
    endTime: number;
    keywords?: string[];
    isPartial?: boolean;
    isStreaming?: boolean;
}

export interface SelectOption {
    label: string;
    value: string;
    badge?: string;
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
    displayName?: string;
    duration: string;
    durationSeconds?: number;
    startTime?: number;
    endTime?: number;
    filePath?: string;
    text?: string;
}

export type AudioGenerationTaskStatus = 'pending' | 'processing' | 'partial_failed' | 'completed';
export type AudioGenerationSegmentStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

export interface AudioGenerationSegmentItem {
    id: string;
    segmentIndex: number;
    speaker: string;
    text: string;
    status: AudioGenerationSegmentStatus;
    fileName?: string;
    filePath?: string;
    errorMessage?: string;
    attemptCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface AudioGenerationTaskItem {
    id: string;
    batchId: string;
    status: AudioGenerationTaskStatus;
    audioDir: string;
    ttsEndpointId: string;
    totalSegments: number;
    successSegments: number;
    failedSegments: number;
    mergedAudioRecordId?: string;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
    segments: AudioGenerationSegmentItem[];
}

export interface StatusCheckItem {
    label: string;
    status: 'ready' | 'connected' | 'warning';
}

export interface ProviderOption extends SelectOption {
    description?: string;
}

export interface ModelOption {
    label: string;
    value: string;
    tag?: string;
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

export interface PromptTemplate {
    id: string;
    title: string;
    description: string;
    systemPrompt: string;
}

export interface AppConfig {
    activeLlmId: string;
    llmEndpoints: LlmEndpointConfig[];
    activeTtsId: string;
    ttsEndpoints: TtsEndpointConfig[];
    activePromptId: string;

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

export interface WorkspaceData {
    config: AppConfig;
    prompts: PromptTemplate[];
}

export interface GenerateConversationInput {
    scenario: string;
    rounds: number;
    supplementalPrompt?: string;
    llmEndpointId?: string;
    systemPrompt?: string;
    requestId?: string;
}

export interface GenerateConversationOutput {
    transcript: TranscriptSegment[];
    taskInfo: TaskMetaItem[];
}

export const CONVERSATION_STARTED_EVENT = 'conversation_started';
export const CONVERSATION_DELTA_EVENT = 'conversation_delta';
export const CONVERSATION_STREAM_DELTA_EVENT = 'conversation_stream_delta';
export const CONVERSATION_COMPLETED_EVENT = 'conversation_completed';
export const CONVERSATION_FAILED_EVENT = 'conversation_failed';

export interface ConversationStreamBaseEvent {
    requestId: string;
}

export interface ConversationStartedEvent extends ConversationStreamBaseEvent {
    rounds: number;
}

export interface ConversationDeltaEvent extends ConversationStreamBaseEvent {
    segment: TranscriptSegment;
}

export interface ConversationStreamDeltaEvent extends ConversationStreamBaseEvent {
    textDelta: string;
}

export interface ConversationCompletedEvent extends ConversationStreamBaseEvent {
    transcript: TranscriptSegment[];
    taskInfo: TaskMetaItem[];
}

export interface ConversationFailedEvent extends ConversationStreamBaseEvent {
    message: string;
}

export interface GenerateAudioInput {
    transcript: TranscriptSegment[];
    salesVoice: string;
    customerVoice: string;
    audioDir: string;
}

export interface GenerateAudioOutput {
    task: AudioGenerationTaskItem;
    audioFiles: AudioFileItem[];
    mergedFile?: AudioFileItem;
}

export interface HealthStatus {
    system: StatusCheckItem[];
    message: string;
}

export interface GenerateBusyState {
    generatingConversation: boolean;
    generatingAudio: boolean;
}
