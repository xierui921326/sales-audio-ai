import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Sidebar from './components/layout/Sidebar';
import StorageHeader from './components/config/StorageHeader';
import GeneratePage from './pages/GeneratePage';
import TaskCenterPage from './pages/TaskCenterPage';
import AudioPage from './pages/AudioPage';
import LlmConfigPage from './pages/LlmConfigPage';
import TtsConfigPage from './pages/TtsConfigPage';
import PromptConfigPage from './pages/PromptConfigPage';
import { useAudioPlayback } from './hooks/useAudioPlayback';
import { useConversationGeneration } from './hooks/useConversationGeneration';
import { useWorkspaceState } from './hooks/useWorkspaceState';
import { logger } from './utils/logger';

import {
  NavigationItemId,
  AppConfig,
  TranscriptSegment,
  AudioFileItem,
  AudioGenerationTaskItem,
  GenerateConversationInput,
  GenerateAudioOutput,
  GenerateBusyState,
  PromptTemplate,
} from './types';

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

type SaveNoticeText = '备注名保存成功' | '备注名保存失败';

type SaveNoticeState = {
  text: SaveNoticeText;
  tone: 'success' | 'error';
} | null;

type ParsedGenerateDialogContent = {
  severity: 'default' | 'advisory';
  summary: string;
  detail: string | null;
};

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTimeCN(value: string): string {
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

function normalizeDialogText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function readStringField(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) {
    return '';
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : '';
}

function parseRemoteServiceError(rawText: string): ParsedGenerateDialogContent | null {
  const jsonStart = rawText.indexOf('{');
  const jsonEnd = rawText.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1)) as unknown;
    const errorPayload = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).error : null;
    const message = normalizeDialogText(readStringField(errorPayload, 'message'));
    const type = readStringField(errorPayload, 'type');
    const code = readStringField(errorPayload, 'code');
    const requestIdMatch = message.match(/request id:\s*([^\)]+)/i);
    const requestId = requestIdMatch?.[1]?.trim() ?? '';

    const detailLines = [
      code ? `错误码：${code}` : '',
      type ? `错误类型：${type}` : '',
      requestId ? `请求标识：${requestId}` : '',
      message ? `服务返回：${message}` : '',
    ].filter(Boolean);

    if (code === 'sensitive_words_detected' || message.includes('sensitive_words_detected')) {
      return {
        severity: 'advisory',
        summary: '当前输入内容触发了模型服务的内容安全校验，请调整“对话场景”或“补充要求”后再试。',
        detail: detailLines.join('\n') || null,
      };
    }

    return {
      severity: 'default',
      summary: '模型服务拒绝了本次请求，请检查输入内容、模型配置，或稍后重试。',
      detail: detailLines.join('\n') || null,
    };
  } catch {
    return null;
  }
}

function copyTextToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

function getGenerateDialogContent(dialog: NonNullable<GenerateDialogState>): ParsedGenerateDialogContent {
  if (dialog.tone !== 'error') {
    return {
      severity: 'default',
      summary: dialog.text,
      detail: null,
    };
  }

  if (dialog.text.includes('远程模型返回失败')) {
    const parsed = parseRemoteServiceError(dialog.text);
    if (parsed) {
      return parsed;
    }
  }

  return {
    severity: 'default',
    summary: dialog.text,
    detail: null,
  };
}

let initialAudioGenerationResourcesPromise: Promise<{ records: AudioFileItem[]; tasks: AudioGenerationTaskItem[] }> | null = null;

function loadInitialAudioGenerationResources(): Promise<{ records: AudioFileItem[]; tasks: AudioGenerationTaskItem[] }> {
  if (!initialAudioGenerationResourcesPromise) {
    initialAudioGenerationResourcesPromise = Promise.all([
      invoke<AudioFileItem[]>('list_audio_files'),
      invoke<AudioGenerationTaskItem[]>('list_audio_generation_tasks'),
    ])
      .then(([records, tasks]) => {
        logger.info('audio', '音频历史加载完成', { fileCount: records.length });
        logger.info('audio', '音频任务加载完成', { taskCount: tasks.length });
        return { records, tasks };
      })
      .catch((err) => {
        logger.error('audio', '初始化音频资源加载失败', err);
        initialAudioGenerationResourcesPromise = null;
        throw err;
      });
  }

  return initialAudioGenerationResourcesPromise;
}

export default function App() {
  const [activeNav, setActiveNav] = useState<NavigationItemId>('generate');
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [displayStreamingText, setDisplayStreamingText] = useState('');
  const [busy, setBusy] = useState<GenerateBusyState>({
    generatingConversation: false,
    generatingAudio: false,
  });
  const [audioFiles, setAudioFiles] = useState<AudioFileItem[]>([]);
  const [audioGenerationTasks, setAudioGenerationTasks] = useState<AudioGenerationTaskItem[]>([]);
  const [generateDialog, setGenerateDialog] = useState<GenerateDialogState>(null);
  const [saveNotice, setSaveNotice] = useState<SaveNoticeState>(null);
  const [generateDialogDetailExpanded, setGenerateDialogDetailExpanded] = useState(false);
  const [generateDialogCopyState, setGenerateDialogCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const displayTranscript = useMemo(() => buildDisplayTranscript(transcript, displayStreamingText), [transcript, displayStreamingText]);
  const generateDialogContent = useMemo(() => (generateDialog ? getGenerateDialogContent(generateDialog) : null), [generateDialog]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialAudioResources() {
      try {
        const { records, tasks } = await loadInitialAudioGenerationResources();
        if (cancelled) {
          return;
        }
        setAudioFiles(records);
        setAudioGenerationTasks(tasks);
      } catch {
        return;
      }
    }

    void loadInitialAudioResources();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setGenerateDialogDetailExpanded(false);
    setGenerateDialogCopyState('idle');
  }, [generateDialog]);

  useEffect(() => {
    if (generateDialogCopyState === 'idle') {
      return;
    }

    const timer = window.setTimeout(() => {
      setGenerateDialogCopyState('idle');
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [generateDialogCopyState]);

  const reloadAudioGenerationTasks = useCallback(async () => {
    try {
      const tasks = await invoke<AudioGenerationTaskItem[]>('list_audio_generation_tasks');
      setAudioGenerationTasks(tasks);
      logger.info('audio', '音频任务加载完成', { taskCount: tasks.length });
    } catch (err) {
      logger.error('audio', '加载音频任务失败', err);
    }
  }, []);

  const reloadAudioFiles = useCallback(async () => {
    try {
      const records = await invoke<AudioFileItem[]>('list_audio_files');
      setAudioFiles(records);
      logger.info('audio', '音频历史加载完成', { fileCount: records.length });
    } catch (err) {
      logger.error('audio', '加载音频历史失败', err);
    }
  }, []);

  const reloadAudioGenerationResources = useCallback(async () => {
    await Promise.all([reloadAudioFiles(), reloadAudioGenerationTasks()]);
  }, [reloadAudioFiles, reloadAudioGenerationTasks]);

  const {
    playingId,
    isPlaying,
    currentTime,
    currentDuration,
    loadingAudioId,
    resetAudioPlayback,
    handleSeek,
    handleSkip,
    handlePlay,
  } = useAudioPlayback({
    audioFiles,
    onPlaybackError: setGenerateDialog,
  });
  const {
    config,
    setConfig,
    savedConfigSnapshot,
    prompts,
    setPrompts,
    configSaveState,
    promptSaveState,
    hasUnsavedChanges,
    hasUnsavedPromptChanges,
    handleSaveConfig,
    handleSavePrompts,
  } = useWorkspaceState();
  const { handleGenerateConversation } = useConversationGeneration({
    setTranscript,
    setStreamingText,
    setDisplayStreamingText,
    setGenerateDialog,
    setBusy,
    upsertTranscriptSegment,
  });

  async function handleCopyGenerateDialogDetail() {
    if (!generateDialog || !generateDialogContent?.detail) {
      return;
    }

    const textToCopy = [generateDialog.title, generateDialogContent.summary, generateDialogContent.detail].filter(Boolean).join('\n\n');

    try {
      await copyTextToClipboard(textToCopy);
      setGenerateDialogCopyState('success');
    } catch {
      setGenerateDialogCopyState('error');
    }
  }

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
    if (!saveNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSaveNotice(current => (current?.text === saveNotice.text ? null : current));
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [saveNotice]);

  function updateAudioFile(updated: AudioFileItem) {
    setAudioFiles(current => current.map(file => (file.id === updated.id ? { ...file, ...updated } : file)));
  }

  function showSaveNotice(text: SaveNoticeText, tone: 'success' | 'error') {
    setSaveNotice({ text, tone });
  }

  async function handleSaveAudioDisplayName(id: string, displayName: string) {
    try {
      const updated = await invoke<AudioFileItem>('update_audio_display_name', {
        id,
        displayName,
      });
      updateAudioFile(updated);
      showSaveNotice('备注名保存成功', 'success');
      logger.info('audio', '音频备注更新成功', { id, displayName: updated.displayName });
    } catch (err) {
      logger.error('audio', '音频备注更新失败', err);
      showSaveNotice('备注名保存失败', 'error');
      throw err;
    }
  }

  function handleSetPrompts(nextPrompts: React.SetStateAction<PromptTemplate[]>) {
    setPrompts(nextPrompts);
  }

  async function handleGenerateAudio() {
    if (transcript.length === 0) return;
    setBusy(current => ({ ...current, generatingAudio: true }));
    try {
      logger.info('audio', '开始生成音频', { transcriptSize: transcript.length });
      const result = await invoke<GenerateAudioOutput>('generate_audio', {
        input: {
          transcript,
          salesVoice: '',
          customerVoice: '',
          audioDir: config.audioDir,
        },
      });
      await reloadAudioGenerationResources();
      resetAudioPlayback();

      if (result.task.status === 'completed') {
        logger.info('audio', '音频生成成功', {
          taskId: result.task.id,
          fileCount: result.audioFiles.length,
          mergedFile: result.mergedFile?.fileName ?? '',
        });
        setGenerateDialog({
          title: '音频生成完成',
          text: `已完成 ${result.task.successSegments}/${result.task.totalSegments} 个片段，并生成合并音频。`,
          tone: 'success',
        });
        return;
      }

      logger.warn('audio', '音频生成部分失败', {
        taskId: result.task.id,
        successSegments: result.task.successSegments,
        failedSegments: result.task.failedSegments,
      });
      setGenerateDialog({
        title: '部分片段生成失败',
        text: `已成功 ${result.task.successSegments}/${result.task.totalSegments} 个片段，剩余失败片段可在下方任务列表中重试。`,
        tone: 'info',
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

  async function handleRetryAudioTask(taskId: string) {
    setBusy(current => ({ ...current, generatingAudio: true }));
    try {
      logger.info('audio', '开始重试音频任务', { taskId });
      const result = await invoke<GenerateAudioOutput>('retry_audio_generation_task', { taskId });
      await reloadAudioGenerationResources();
      resetAudioPlayback();

      if (result.task.status === 'completed') {
        logger.info('audio', '音频任务重试完成', {
          taskId,
          mergedFile: result.mergedFile?.fileName ?? '',
        });
        setGenerateDialog({
          title: '重试完成',
          text: `任务已完成，${result.task.totalSegments} 个片段均已生成。`,
          tone: 'success',
        });
        return;
      }

      logger.warn('audio', '音频任务重试后仍有失败片段', {
        taskId,
        successSegments: result.task.successSegments,
        failedSegments: result.task.failedSegments,
      });
      setGenerateDialog({
        title: '仍有失败片段',
        text: `当前已成功 ${result.task.successSegments}/${result.task.totalSegments} 个片段，请稍后继续重试。`,
        tone: 'info',
      });
    } catch (err) {
      logger.error('audio', '重试音频任务失败', err);
      setGenerateDialog({
        title: '重试失败',
        text: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setBusy(current => ({ ...current, generatingAudio: false }));
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
              audioGenerationTasks={audioGenerationTasks}
              playingId={playingId}
              isPlaying={isPlaying}
              currentTime={currentTime}
              currentDuration={currentDuration}
              loadingAudioId={loadingAudioId}
              onPlay={handlePlay}
              onSeek={handleSeek}
              onSkip={handleSkip}
              onSaveAudioDisplayName={handleSaveAudioDisplayName}
              onGenerateConv={handleGenerateConversation}
              onGenerateAudio={handleGenerateAudio}
              onRetryAudioTask={handleRetryAudioTask}
              formatTaskTime={formatDateTimeCN}
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
            <div className={`dialog-badge dialog-badge--${generateDialog.tone === 'error' && generateDialogContent?.severity === 'advisory' ? 'advisory' : generateDialog.tone}`}>
              {generateDialog.tone === 'success'
                ? '成功'
                : generateDialog.tone === 'info'
                  ? '提示'
                  : generateDialogContent?.severity === 'advisory'
                    ? '提醒'
                    : '错误'}
            </div>
            <div className="dialog-title">{generateDialog.title}</div>
            <div className="dialog-text">
              <div className="dialog-summary">{generateDialogContent?.summary ?? generateDialog.text}</div>
              {generateDialogContent?.detail ? (
                <div className="dialog-detail">
                  <div className="dialog-detail-header">
                    <div className="dialog-detail-label">详细信息</div>
                    <div className="dialog-detail-controls">
                      <button
                        className="dialog-detail-toggle"
                        type="button"
                        onClick={() => setGenerateDialogDetailExpanded(current => !current)}
                      >
                        {generateDialogDetailExpanded ? '收起详情' : '查看详情'}
                      </button>
                      <button
                        className={`dialog-detail-copy dialog-detail-copy--${generateDialogCopyState}`}
                        type="button"
                        onClick={() => void handleCopyGenerateDialogDetail()}
                      >
                        {generateDialogCopyState === 'success' ? '已复制' : generateDialogCopyState === 'error' ? '复制失败' : '复制详情'}
                      </button>
                    </div>
                  </div>
                  {generateDialogDetailExpanded ? (
                    <div className="dialog-detail-content">{generateDialogContent.detail}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="dialog-actions">
              <button className="chip-button is-active" onClick={() => setGenerateDialog(null)} type="button">
                我知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saveNotice ? (
        <button
          className={`floating-notice floating-notice--${saveNotice.tone}`}
          type="button"
          onClick={() => setSaveNotice(null)}
          aria-label={saveNotice.text}
        >
          {saveNotice.text}
        </button>
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
  audioGenerationTasks: AudioGenerationTaskItem[];
  playingId: string | null;
  isPlaying: boolean;
  currentTime: number;
  currentDuration: number;
  loadingAudioId: string | null;
  onPlay: (id: string) => Promise<void>;
  onSeek: (id: string, nextTime: number) => void;
  onSkip: (id: string, deltaSeconds: number) => void;
  onSaveAudioDisplayName: (id: string, displayName: string) => Promise<void>;
  onGenerateConv: (params: GenerateConversationInput) => Promise<void>;
  onGenerateAudio: () => Promise<void>;
  onRetryAudioTask: (taskId: string) => Promise<void>;
  formatTaskTime: (value: string) => string;
  onSaveConfig: () => Promise<void>;
  onSavePrompts: () => Promise<void>;
  configSaveState: 'idle' | 'saving' | 'success' | 'error';
  promptSaveState: 'idle' | 'saving' | 'success' | 'error';
  hasUnsavedChanges: boolean;
  hasUnsavedPromptChanges: boolean;
  busy: GenerateBusyState;
}

function MainContent({ activeNav, config, setConfig, savedConfigSnapshot, prompts, setPrompts, transcript, streamingText, audioFiles, audioGenerationTasks, playingId, isPlaying, currentTime, currentDuration, loadingAudioId, onPlay, onSeek, onSkip, onSaveAudioDisplayName, onGenerateConv, onGenerateAudio, onRetryAudioTask, formatTaskTime, onSaveConfig, onSavePrompts, configSaveState, promptSaveState, hasUnsavedChanges, hasUnsavedPromptChanges, busy }: MainContentProps) {
  switch (activeNav) {
    case 'generate':
      return <GeneratePage config={config} prompts={prompts} transcript={transcript} streamingText={streamingText} onGenerate={onGenerateConv} onGenerateAudio={onGenerateAudio} busy={busy} />;
    case 'tasks':
      return <TaskCenterPage audioGenerationTasks={audioGenerationTasks} formatTaskTime={formatTaskTime} onRetryAudioTask={onRetryAudioTask} busy={busy.generatingAudio} />;
    case 'audio':
      return (
        <div className="page-view flex-col animate-fade-in">
          <StorageHeader config={config} setConfig={setConfig} />
          <AudioPage
            audioFiles={audioFiles}
            playingId={playingId}
            isPlaying={isPlaying}
            currentTime={currentTime}
            currentDuration={currentDuration}
            loadingAudioId={loadingAudioId}
            onPlay={onPlay}
            onSeek={onSeek}
            onSkip={onSkip}
            onSaveDisplayName={onSaveAudioDisplayName}
            busy={busy.generatingAudio}
          />
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
