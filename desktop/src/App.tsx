import React, { useMemo, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Sidebar from './components/layout/Sidebar';
import StorageHeader from './components/config/StorageHeader';
import GeneratePage from './pages/GeneratePage';
import AudioPage from './pages/AudioPage';
import LlmConfigPage from './pages/LlmConfigPage';
import TtsConfigPage from './pages/TtsConfigPage';

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

  // Lifecycle
  useEffect(() => {
    async function load() {
      try {
        const workspace = await invoke<WorkspaceData>('load_workspace');
        setConfig(workspace.config);
        setSavedConfigSnapshot(workspace.config);
      } catch (err) {
        console.error(err);
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
      const savedConfig = await invoke<AppConfig>('save_config', { config });
      setConfig(savedConfig);
      setSavedConfigSnapshot(savedConfig);
      setConfigSaveState('success');
    } catch (err) {
      console.error(err);
      setConfigSaveState('error');
    }
  }

  // Actions
  async function handleGenerateConversation(params: GenerateConversationInput) {
    setBusy(true);
    setTranscript([]);
    try {
      const result = await invoke<GenerateConversationOutput>('generate_conversation', { input: params });
      setTranscript(result.transcript);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateAudio() {
    if (transcript.length === 0) return;
    setBusy(true);
    try {
      await invoke('generate_audio_batch', { segments: transcript });
      const list = await invoke<AudioFileItem[]>('list_audios');
      setAudioFiles(list);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  function handlePlay(id: string) {
    setPlayingId(id === playingId ? null : id);
    invoke('play_audio_item', { id }).catch(console.error);
  }

  const llmSupplierLocked = savedConfigSnapshot.llmEndpoints.some(e => e.id === config.activeLlmId);
  const ttsSupplierLocked = savedConfigSnapshot.ttsEndpoints.some(e => e.id === config.activeTtsId);

  return (
    <div className="app-shell">
      <Sidebar activeNav={activeNav} onNavChange={setActiveNav} />
      <div className="workspace-shell">
        <main className="workspace-main">
          <MainContent
            activeNav={activeNav}
            config={config}
            setConfig={setConfig}
            transcript={transcript}
            audioFiles={audioFiles}
            playingId={playingId}
            onPlay={handlePlay}
            onGenerateConv={handleGenerateConversation}
            onGenerateAudio={handleGenerateAudio}
            onSaveConfig={handleSaveConfig}
            configSaveState={configSaveState}
            hasUnsavedChanges={hasUnsavedChanges}
            llmSupplierLocked={llmSupplierLocked}
            ttsSupplierLocked={ttsSupplierLocked}
            busy={busy}
          />
        </main>
      </div>
    </div>
  );
}

interface MainContentProps {
  activeNav: NavigationItemId;
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  transcript: TranscriptSegment[];
  audioFiles: AudioFileItem[];
  playingId: string | null;
  onPlay: (id: string) => void;
  onGenerateConv: (params: GenerateConversationInput) => Promise<void>;
  onGenerateAudio: () => Promise<void>;
  onSaveConfig: () => Promise<void>;
  configSaveState: 'idle' | 'saving' | 'success' | 'error';
  hasUnsavedChanges: boolean;
  llmSupplierLocked: boolean;
  ttsSupplierLocked: boolean;
  busy: boolean;
}

function MainContent({ activeNav, config, setConfig, transcript, audioFiles, playingId, onPlay, onGenerateConv, onGenerateAudio, onSaveConfig, configSaveState, hasUnsavedChanges, llmSupplierLocked, ttsSupplierLocked, busy }: MainContentProps) {
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
      return <LlmConfigPage config={config} setConfig={setConfig} onSaveConfig={onSaveConfig} configSaveState={configSaveState} hasUnsavedChanges={hasUnsavedChanges} supplierLocked={llmSupplierLocked} />;
    case 'tts':
      return <TtsConfigPage config={config} setConfig={setConfig} onSaveConfig={onSaveConfig} configSaveState={configSaveState} hasUnsavedChanges={hasUnsavedChanges} supplierLocked={ttsSupplierLocked} />;
    default:
      return <div className="empty-page-message">模块开发中...</div>;
  }
}

