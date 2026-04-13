import React, { useMemo, useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import Sidebar from './components/layout/Sidebar';
import StorageHeader from './components/config/StorageHeader';
import GeneratePage from './pages/GeneratePage';
import AudioPage from './pages/AudioPage';
import LlmConfigPage from './pages/LlmConfigPage';
import TtsConfigPage from './pages/TtsConfigPage';
import PromptConfigPage from './pages/PromptConfigPage';
import { logger } from './utils/logger';

import {
  NavigationItemId,
  AppConfig,
  TranscriptSegment,
  AudioFileItem,
  WorkspaceData,
  GenerateConversationInput,
  GenerateConversationOutput,
  GenerateBusyState,
  PromptTemplate,
  ConversationStartedEvent,
  ConversationDeltaEvent,
  ConversationStreamDeltaEvent,
  ConversationCompletedEvent,
  ConversationFailedEvent,
  CONVERSATION_STARTED_EVENT,
  CONVERSATION_DELTA_EVENT,
  CONVERSATION_STREAM_DELTA_EVENT,
  CONVERSATION_COMPLETED_EVENT,
  CONVERSATION_FAILED_EVENT,
} from './types';

const DEFAULT_CONFIG: AppConfig = {
  activeLlmId: '',
  llmEndpoints: [],
  activeTtsId: '',
  ttsEndpoints: [],
  activePromptId: '',
  audioDir: '',
  databasePath: '',
  configFile: '',
};

const DEFAULT_PROMPTS: PromptTemplate[] = [];

function createRequestId(): string {
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function upsertTranscriptSegment(current: TranscriptSegment[], incoming: TranscriptSegment): TranscriptSegment[] {
  const index = current.findIndex(segment => segment.id === incoming.id);
  if (index === -1) {
    return [...current, incoming];
  }

  const next = [...current];
  next[index] = {
    ...next[index],
    ...incoming,
  };
  return next;
}

function decodeStreamingJsonText(value: string): string {
  return value
    .replace(/\\u([\da-fA-F]{4})/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

const FALLBACK_SEGMENT_MIN_SECONDS = 2;
const FALLBACK_SEGMENT_MAX_SECONDS = 12;
const FALLBACK_CHARS_PER_SECOND = 6;
const FALLBACK_SEGMENT_GAP_SECONDS = 1;

function estimateFallbackSegmentSeconds(text: string): number {
  const estimated = Math.ceil(text.length / FALLBACK_CHARS_PER_SECOND);
  return Math.min(FALLBACK_SEGMENT_MAX_SECONDS, Math.max(FALLBACK_SEGMENT_MIN_SECONDS, estimated));
}

function extractFallbackSegments(streamingText: string): TranscriptSegment[] {
  const speakerMatches = [...streamingText.matchAll(/"speaker"\s*:\s*"(sales|customer)"/g)];
  if (speakerMatches.length === 0) {
    return [];
  }

  const fallbackSegments: TranscriptSegment[] = [];
  let currentStartTime = 0;

  for (let index = 0; index < speakerMatches.length; index += 1) {
    const speakerMatch = speakerMatches[index];
    if (speakerMatch.index === undefined) {
      continue;
    }

    const speaker = speakerMatch[1] as TranscriptSegment['speaker'];
    const textSearchStart = speakerMatch.index + speakerMatch[0].length;
    const nextSpeakerIndex = speakerMatches[index + 1]?.index ?? streamingText.length;
    const textFieldMatch = /"text"\s*:\s*"/.exec(streamingText.slice(textSearchStart, nextSpeakerIndex));
    if (!textFieldMatch || textFieldMatch.index === undefined) {
      continue;
    }

    const rawTextStart = textSearchStart + textFieldMatch.index + textFieldMatch[0].length;
    let cursor = rawTextStart;
    let escaped = false;
    let rawText = '';

    while (cursor < streamingText.length) {
      const char = streamingText[cursor];
      if (escaped) {
        rawText += `\\${char}`;
        escaped = false;
        cursor += 1;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        cursor += 1;
        continue;
      }
      if (char === '"') {
        break;
      }
      rawText += char;
      cursor += 1;
    }

    const text = decodeStreamingJsonText(rawText).trim();
    if (!text) {
      continue;
    }

    const duration = estimateFallbackSegmentSeconds(text);
    const startTime = currentStartTime;
    const endTime = startTime + duration;
    currentStartTime = endTime + FALLBACK_SEGMENT_GAP_SECONDS;

    fallbackSegments.push({
      id: `fallback-${index}`,
      speaker,
      text,
      startTime,
      endTime,
      isPartial: true,
    });
  }

  return fallbackSegments;
}

function buildDisplayTranscript(transcript: TranscriptSegment[], streamingText: string): TranscriptSegment[] {
  const fallbackSegments = extractFallbackSegments(streamingText);
  const transcriptWithState = transcript.map((segment, index) => ({
    ...segment,
    isStreaming: segment.isPartial ? index === transcript.length - 1 : false,
  }));

  if (fallbackSegments.length === 0) {
    return transcriptWithState;
  }

  const merged = [...transcriptWithState];
  for (let index = transcript.length; index < fallbackSegments.length; index += 1) {
    merged.push({
      ...fallbackSegments[index],
      isStreaming: index === fallbackSegments.length - 1,
    });
  }

  return merged;
}

type GenerateDialogState = {
  title: string;
  text: string;
  tone: 'error' | 'info' | 'success';
} | null;

export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [activeNav, setActiveNav] = useState<NavigationItemId>('generate');
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [displayStreamingText, setDisplayStreamingText] = useState('');
  const [busy, setBusy] = useState<GenerateBusyState>({
    generatingConversation: false,
    generatingAudio: false,
  });
  const [audioFiles, setAudioFiles] = useState<AudioFileItem[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [configSaveState, setConfigSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [savedConfigSnapshot, setSavedConfigSnapshot] = useState<AppConfig>(DEFAULT_CONFIG);
  const [prompts, setPrompts] = useState<PromptTemplate[]>(DEFAULT_PROMPTS);
  const [savedPromptsSnapshot, setSavedPromptsSnapshot] = useState<PromptTemplate[]>(DEFAULT_PROMPTS);
  const [promptSaveState, setPromptSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [generateDialog, setGenerateDialog] = useState<GenerateDialogState>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const generateRequestIdRef = useRef<string | null>(null);
  const generateListenersRef = useRef<UnlistenFn[]>([]);
  const displayTranscript = useMemo(() => buildDisplayTranscript(transcript, displayStreamingText), [transcript, displayStreamingText]);

  useEffect(() => {
    if (!streamingText) {
      setDisplayStreamingText('');
      return;
    }

    if (displayStreamingText === streamingText) {
      return;
    }

    const remainingText = streamingText.slice(displayStreamingText.length);
    const nextChar = remainingText[0] ?? '';
    const prevChar = displayStreamingText[displayStreamingText.length - 1] ?? '';
    const isSentenceBreak = /[，。！？：；,.!?;\n]/.test(prevChar);
    const isClauseStart = displayStreamingText.length === 0 || isSentenceBreak;
    const nextChunk =
      remainingText.match(/^\s+/)?.[0] ??
      remainingText.match(/^[，。！？：；,.!?;]+/)?.[0] ??
      remainingText.match(/^[0-9A-Za-z]{1,4}/)?.[0] ??
      remainingText.match(/^[^\s，。！？：；,.!?;\n]{1,2}/u)?.[0] ??
      nextChar;
    const nextLength = Math.min(streamingText.length, displayStreamingText.length + nextChunk.length);

    let delay = 74;
    if (isClauseStart) {
      delay = 190;
    } else if (/^[，。！？：；,.!?;]+$/.test(nextChunk)) {
      delay = 146;
    } else if (/^\s+$/.test(nextChunk)) {
      delay = 96;
    } else if (/^[0-9A-Za-z]+$/.test(nextChunk)) {
      delay = 88;
    } else if (nextChunk.length === 2) {
      delay = 82;
    }

    const timer = window.setTimeout(() => {
      setDisplayStreamingText(streamingText.slice(0, nextLength));
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [displayStreamingText, streamingText]);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const revokeAudioObjectUrl = () => {
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
    };

    const handleEnded = () => {
      setPlayingId(null);
      revokeAudioObjectUrl();
    };

    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.pause();
      audio.removeEventListener('ended', handleEnded);
      revokeAudioObjectUrl();
      audioRef.current = null;
    };
  }, []);

  async function reloadAudioFiles() {
    try {
      const records = await invoke<AudioFileItem[]>('list_audio_files');
      setAudioFiles(records);
      logger.info('audio', '音频历史加载完成', { fileCount: records.length });
    } catch (err) {
      logger.error('audio', '加载音频历史失败', err);
    }
  }

  function clearGenerateListeners() {
    const listeners = generateListenersRef.current;
    generateListenersRef.current = [];
    for (const unlisten of listeners) {
      void Promise.resolve(unlisten()).catch(err => {
        logger.warn('generate', '清理对话流监听失败', err);
      });
    }
  }

  useEffect(() => {
    return () => {
      clearGenerateListeners();
    };
  }, []);

  useEffect(() => {
    async function load() {
      try {
        logger.info('app', '开始加载工作区');
        const workspace = await invoke<WorkspaceData>('load_workspace');
        setConfig(workspace.config);
        setSavedConfigSnapshot(workspace.config);
        setPrompts(workspace.prompts);
        setSavedPromptsSnapshot(workspace.prompts);
        await reloadAudioFiles();
        logger.info('app', '工作区加载完成', {
          llmCount: workspace.config.llmEndpoints.length,
          ttsCount: workspace.config.ttsEndpoints.length,
          promptCount: workspace.prompts.length,
        });
      } catch (err) {
        logger.error('app', '加载工作区失败', err);
      } finally {
        setConfigLoaded(true);
      }
    }

    load();
  }, []);

  const hasUnsavedChanges = useMemo(() => {
    if (!configLoaded) {
      return false;
    }

    return JSON.stringify(config) !== JSON.stringify(savedConfigSnapshot);
  }, [config, configLoaded, savedConfigSnapshot]);

  const hasUnsavedPromptChanges = useMemo(() => {
    if (!configLoaded) {
      return false;
    }

    return JSON.stringify(prompts) !== JSON.stringify(savedPromptsSnapshot);
  }, [configLoaded, prompts, savedPromptsSnapshot]);

  useEffect(() => {
    if (promptSaveState === 'success' || promptSaveState === 'error') {
      setPromptSaveState('idle');
    }
  }, [prompts, promptSaveState]);

  useEffect(() => {
    if (configSaveState === 'success' || configSaveState === 'error') {
      setConfigSaveState('idle');
    }
  }, [config, configSaveState]);

  async function handleSavePrompts() {
    if (!configLoaded) {
      return;
    }

    setPromptSaveState('saving');
    try {
      logger.info('prompt', '开始保存 Prompt 模板', { promptCount: prompts.length });
      const savedPrompts = await invoke<PromptTemplate[]>('save_prompts', { prompts });
      setPrompts(savedPrompts);
      setSavedPromptsSnapshot(savedPrompts);
      setPromptSaveState('success');
      logger.info('prompt', 'Prompt 模板保存成功', { promptCount: savedPrompts.length });
    } catch (err) {
      logger.error('prompt', 'Prompt 模板保存失败', err);
      setPromptSaveState('error');
    }
  }

  function handleSetPrompts(nextPrompts: React.SetStateAction<PromptTemplate[]>) {
    setPrompts(nextPrompts);
  }

  async function handleSaveConfig() {
    if (!configLoaded) {
      return;
    }

    setConfigSaveState('saving');
    try {
      logger.info('config', '开始保存配置');
      const savedConfig = await invoke<AppConfig>('save_config', { config });
      setConfig(savedConfig);
      setSavedConfigSnapshot(savedConfig);
      setConfigSaveState('success');
      logger.info('config', '配置保存成功');
    } catch (err) {
      logger.error('config', '配置保存失败', err);
      setConfigSaveState('error');
    }
  }

  async function handleGenerateConversation(params: GenerateConversationInput) {
    const requestId = createRequestId();
    generateRequestIdRef.current = requestId;
    clearGenerateListeners();
    setBusy(current => ({ ...current, generatingConversation: true }));
    setGenerateDialog(null);
    setTranscript([]);
    setStreamingText('');
    setDisplayStreamingText('');

    try {
      const listeners = await Promise.all([
        listen<ConversationStartedEvent>(CONVERSATION_STARTED_EVENT, event => {
          if (event.payload.requestId !== generateRequestIdRef.current) {
            return;
          }
          setStreamingText('');
          setDisplayStreamingText('');
          logger.info('generate', '开始接收流式对话', { rounds: event.payload.rounds, requestId: event.payload.requestId });
        }),
        listen<ConversationStreamDeltaEvent>(CONVERSATION_STREAM_DELTA_EVENT, event => {
          if (event.payload.requestId !== generateRequestIdRef.current) {
            return;
          }
          setStreamingText(current => current + event.payload.textDelta);
        }),
        listen<ConversationDeltaEvent>(CONVERSATION_DELTA_EVENT, event => {
          if (event.payload.requestId !== generateRequestIdRef.current) {
            return;
          }
          setTranscript(current => upsertTranscriptSegment(current, event.payload.segment));
        }),
        listen<ConversationCompletedEvent>(CONVERSATION_COMPLETED_EVENT, event => {
          if (event.payload.requestId !== generateRequestIdRef.current) {
            return;
          }
          setTranscript(event.payload.transcript);
          setStreamingText('');
          setDisplayStreamingText('');
          logger.info('generate', '流式对话完成事件已接收', {
            transcriptSize: event.payload.transcript.length,
            requestId: event.payload.requestId,
          });
        }),
        listen<ConversationFailedEvent>(CONVERSATION_FAILED_EVENT, event => {
          if (event.payload.requestId !== generateRequestIdRef.current) {
            return;
          }
          setTranscript([]);
          setStreamingText('');
          setDisplayStreamingText('');
          logger.warn('generate', '流式对话失败事件已接收', {
            message: event.payload.message,
            requestId: event.payload.requestId,
          });
        }),
      ]);
      generateListenersRef.current = listeners;

      logger.info('generate', '开始生成对话', {
        rounds: params.rounds,
        llmEndpointId: params.llmEndpointId ?? '',
        requestId,
      });
      const result = await invoke<GenerateConversationOutput>('generate_conversation', {
        input: {
          ...params,
          requestId,
        },
      });
      if (generateRequestIdRef.current === requestId) {
        setTranscript(result.transcript);
        setStreamingText('');
        setDisplayStreamingText('');
      }
      logger.info('generate', '生成对话成功', { transcriptSize: result.transcript.length, requestId });
    } catch (err) {
      setTranscript([]);
      setStreamingText('');
      setDisplayStreamingText('');
      logger.error('generate', '生成对话失败', err);
      setGenerateDialog({
        title: '生成失败',
        text: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      if (generateRequestIdRef.current === requestId) {
        setStreamingText('');
        setDisplayStreamingText('');
        generateRequestIdRef.current = null;
      }
      clearGenerateListeners();
      setBusy(current => ({ ...current, generatingConversation: false }));
    }
  }

  async function handleGenerateAudio() {
    if (transcript.length === 0) return;
    setBusy(current => ({ ...current, generatingAudio: true }));
    try {
      logger.info('audio', '开始生成音频', { transcriptSize: transcript.length });
      const result = await invoke<{ audioFiles: AudioFileItem[]; mergedFile: AudioFileItem }>('generate_audio', {
        input: {
          transcript,
          salesVoice: '',
          customerVoice: '',
          audioDir: config.audioDir,
        },
      });
      await reloadAudioFiles();
      setPlayingId(null);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      logger.info('audio', '音频生成成功', {
        fileCount: 1,
        mergedFile: result.mergedFile.fileName,
      });
    } catch (err) {
      logger.error('audio', '音频生成失败', err);
      setGenerateDialog({
        title: '音频生成失败',
        text: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setBusy(current => ({ ...current, generatingAudio: false }));
    }
  }

  async function handlePlay(id: string) {
    const player = audioRef.current;
    const target = audioFiles.find(file => file.id === id)?.filePath;
    if (!player || !target) {
      logger.warn('audio', '未找到可播放的音频路径', { id });
      return;
    }

    const revokeAudioObjectUrl = () => {
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
    };

    if (playingId === id) {
      player.pause();
      player.currentTime = 0;
      player.removeAttribute('src');
      player.load();
      revokeAudioObjectUrl();
      setPlayingId(null);
      return;
    }

    try {
      const audioBytes = await readFile(target);
      const ext = target.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav';
      const audioBlob = new Blob([audioBytes], { type: mimeType });
      const audioUrl = URL.createObjectURL(audioBlob);

      player.pause();
      revokeAudioObjectUrl();
      audioObjectUrlRef.current = audioUrl;
      player.src = audioUrl;
      player.currentTime = 0;
      await player.play();
      setPlayingId(id);
      logger.info('audio', '开始播放音频', { id, target });
    } catch (err) {
      player.pause();
      player.removeAttribute('src');
      player.load();
      revokeAudioObjectUrl();
      setPlayingId(null);
      logger.error('audio', '播放音频失败', err);
      setGenerateDialog({
        title: '播放失败',
        text: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    }
  }

  return (
    <>
      <div className="app-shell">
        <Sidebar activeNav={activeNav} onNavChange={setActiveNav} />
        <div className="workspace-shell">
          <main className="workspace-main">
            <MainContent
              activeNav={activeNav}
              config={config}
              setConfig={setConfig}
              savedConfigSnapshot={savedConfigSnapshot}
              prompts={prompts}
              setPrompts={handleSetPrompts}
              transcript={displayTranscript}
              streamingText={streamingText}
              audioFiles={audioFiles}
              playingId={playingId}
              onPlay={handlePlay}
              onGenerateConv={handleGenerateConversation}
              onGenerateAudio={handleGenerateAudio}
              onSaveConfig={handleSaveConfig}
              onSavePrompts={handleSavePrompts}
              configSaveState={configSaveState}
              promptSaveState={promptSaveState}
              hasUnsavedChanges={hasUnsavedChanges}
              hasUnsavedPromptChanges={hasUnsavedPromptChanges}
              busy={busy}
            />
          </main>
        </div>
      </div>

      {generateDialog ? (
        <div className="dialog-overlay" onClick={() => setGenerateDialog(null)}>
          <div className="dialog-card" onClick={e => e.stopPropagation()}>
            <div className={`dialog-badge dialog-badge--${generateDialog.tone}`}>
              {generateDialog.tone === 'success' ? '成功' : generateDialog.tone === 'info' ? '提示' : '错误'}
            </div>
            <div className="dialog-title">{generateDialog.title}</div>
            <div className="dialog-text">{generateDialog.text}</div>
            <div className="dialog-actions">
              <button className="chip-button is-active" onClick={() => setGenerateDialog(null)} type="button">
                我知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

interface MainContentProps {
  activeNav: NavigationItemId;
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  savedConfigSnapshot: AppConfig;
  prompts: PromptTemplate[];
  setPrompts: React.Dispatch<React.SetStateAction<PromptTemplate[]>>;
  transcript: TranscriptSegment[];
  streamingText: string;
  audioFiles: AudioFileItem[];
  playingId: string | null;
  onPlay: (id: string) => void;
  onGenerateConv: (params: GenerateConversationInput) => Promise<void>;
  onGenerateAudio: () => Promise<void>;
  onSaveConfig: () => Promise<void>;
  onSavePrompts: () => Promise<void>;
  configSaveState: 'idle' | 'saving' | 'success' | 'error';
  promptSaveState: 'idle' | 'saving' | 'success' | 'error';
  hasUnsavedChanges: boolean;
  hasUnsavedPromptChanges: boolean;
  busy: GenerateBusyState;
}

function MainContent({ activeNav, config, setConfig, savedConfigSnapshot, prompts, setPrompts, transcript, streamingText, audioFiles, playingId, onPlay, onGenerateConv, onGenerateAudio, onSaveConfig, onSavePrompts, configSaveState, promptSaveState, hasUnsavedChanges, hasUnsavedPromptChanges, busy }: MainContentProps) {
  switch (activeNav) {
    case 'generate':
      return <GeneratePage config={config} prompts={prompts} transcript={transcript} streamingText={streamingText} onGenerate={onGenerateConv} onGenerateAudio={onGenerateAudio} busy={busy} />;
    case 'audio':
      return (
        <div className="page-view flex-col animate-fade-in">
          <StorageHeader config={config} setConfig={setConfig} />
          <AudioPage audioFiles={audioFiles} playingId={playingId} onPlay={onPlay} busy={busy.generatingAudio} />
        </div>
      );
    case 'llm':
      return <LlmConfigPage config={config} setConfig={setConfig} savedConfigSnapshot={savedConfigSnapshot} onSaveConfig={onSaveConfig} configSaveState={configSaveState} hasUnsavedChanges={hasUnsavedChanges} />;
    case 'tts':
      return <TtsConfigPage config={config} setConfig={setConfig} savedConfigSnapshot={savedConfigSnapshot} onSaveConfig={onSaveConfig} configSaveState={configSaveState} hasUnsavedChanges={hasUnsavedChanges} />;
    case 'prompt':
      return <PromptConfigPage prompts={prompts} setPrompts={setPrompts} onSavePrompts={onSavePrompts} promptSaveState={promptSaveState} hasUnsavedPromptChanges={hasUnsavedPromptChanges} />;
    default:
      return <div className="empty-page-message">模块开发中...</div>;
  }
}
