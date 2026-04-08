import React, { useMemo, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Sidebar from './components/layout/Sidebar';
import StorageHeader from './components/config/StorageHeader';
import GeneratePage from './pages/GeneratePage';
import AudioPage from './pages/AudioPage';
import LlmConfigPage from './pages/LlmConfigPage';
import TtsConfigPage from './pages/TtsConfigPage';
import { logger } from './utils/logger';

import {
  NavigationItemId,
  AppConfig,
  TranscriptSegment,
  AudioFileItem,
  WorkspaceData,
  GenerateConversationInput,
  GenerateConversationOutput,
} from './types';

// Constants & Defaults
const DEFAULT_CONFIG: AppConfig = {
  activeLlmId: '',
  llmEndpoints: [],
  activeTtsId: '',
  ttsEndpoints: [],
  audioDir: '',
  databasePath: '',
  configFile: '',
  fallbackModel: 'gpt-4o-mini',
};

type GenerateDialogState = {
  title: string;
  text: string;
  tone: 'error' | 'info' | 'success';
} | null;

// Main App Component
export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [activeNav, setActiveNav] = useState<NavigationItemId>('generate');
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [busy, setBusy] = useState(false);
  const [audioFiles, setAudioFiles] = useState<AudioFileItem[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [configSaveState, setConfigSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [savedConfigSnapshot, setSavedConfigSnapshot] = useState<AppConfig>(DEFAULT_CONFIG);
  const [generateDialog, setGenerateDialog] = useState<GenerateDialogState>(null);

  // 应用启动时先读取本地工作区配置，后续所有页面都基于这份配置工作。
  useEffect(() => {
    async function load() {
      try {
        logger.info('app', '开始加载工作区');
        const workspace = await invoke<WorkspaceData>('load_workspace');
        setConfig(workspace.config);
        setSavedConfigSnapshot(workspace.config);
        logger.info('app', '工作区加载完成', {
          llmCount: workspace.config.llmEndpoints.length,
          ttsCount: workspace.config.ttsEndpoints.length,
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

  // 生成对话是桌面端的主链路：发请求、接收 transcript、失败时统一弹窗。
  async function handleGenerateConversation(params: GenerateConversationInput) {
    setBusy(true);
    setGenerateDialog(null);
    setTranscript([]);
    try {
      logger.info('generate', '开始生成对话', {
        rounds: params.rounds,
        llmEndpointId: params.llmEndpointId ?? '',
      });
      const result = await invoke<GenerateConversationOutput>('generate_conversation', { input: params });
      setTranscript(result.transcript);
      logger.info('generate', '生成对话成功', { transcriptSize: result.transcript.length });
    } catch (err) {
      logger.error('generate', '生成对话失败', err);
      setGenerateDialog({
        title: '生成失败',
        text: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateAudio() {
    if (transcript.length === 0) return;
    setBusy(true);
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
      setAudioFiles([...result.audioFiles, result.mergedFile]);
      logger.info('audio', '音频生成成功', {
        fileCount: result.audioFiles.length + 1,
      });
    } catch (err) {
      logger.error('audio', '音频生成失败', err);
      setGenerateDialog({
        title: '音频生成失败',
        text: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  function handlePlay(id: string) {
    const nextPlayingId = id === playingId ? null : id;
    setPlayingId(nextPlayingId);

    const target = audioFiles.find(file => file.id === id)?.filePath;
    if (!target) {
      logger.warn('audio', '未找到可播放的音频路径', { id });
      return;
    }

    invoke('open_path', { path: target }).catch(err => {
      logger.error('audio', '打开音频路径失败', err);
    });
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
              transcript={transcript}
              audioFiles={audioFiles}
              playingId={playingId}
              onPlay={handlePlay}
              onGenerateConv={handleGenerateConversation}
              onGenerateAudio={handleGenerateAudio}
              onSaveConfig={handleSaveConfig}
              configSaveState={configSaveState}
              hasUnsavedChanges={hasUnsavedChanges}
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
  transcript: TranscriptSegment[];
  audioFiles: AudioFileItem[];
  playingId: string | null;
  onPlay: (id: string) => void;
  onGenerateConv: (params: GenerateConversationInput) => Promise<void>;
  onGenerateAudio: () => Promise<void>;
  onSaveConfig: () => Promise<void>;
  configSaveState: 'idle' | 'saving' | 'success' | 'error';
  hasUnsavedChanges: boolean;
  busy: boolean;
}

function MainContent({ activeNav, config, setConfig, savedConfigSnapshot, transcript, audioFiles, playingId, onPlay, onGenerateConv, onGenerateAudio, onSaveConfig, configSaveState, hasUnsavedChanges, busy }: MainContentProps) {
  switch (activeNav) {
    case 'generate':
      return <GeneratePage config={config} transcript={transcript} onGenerate={onGenerateConv} onGenerateAudio={onGenerateAudio} busy={busy} />;
    case 'audio':
      return (
        <div className="page-view flex-col animate-fade-in">
          <StorageHeader config={config} setConfig={setConfig} />
          <AudioPage audioFiles={audioFiles} playingId={playingId} onPlay={onPlay} busy={busy} />
        </div>
      );
    case 'llm':
      return <LlmConfigPage config={config} setConfig={setConfig} savedConfigSnapshot={savedConfigSnapshot} onSaveConfig={onSaveConfig} configSaveState={configSaveState} hasUnsavedChanges={hasUnsavedChanges} />;
    case 'tts':
      return <TtsConfigPage config={config} setConfig={setConfig} savedConfigSnapshot={savedConfigSnapshot} onSaveConfig={onSaveConfig} configSaveState={configSaveState} hasUnsavedChanges={hasUnsavedChanges} />;
    default:
      return <div className="empty-page-message">模块开发中...</div>;
  }
}

