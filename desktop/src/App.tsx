import React, { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './styles/globals.css';
import Header from './components/Header';
import TranscriptPanel from './components/TranscriptPanel';
import AnalysisPanel from './components/AnalysisPanel';

import {
  NavigationItemId,
  AppConfig,
  TranscriptSegment,
  AudioFileItem,
  AnalysisResult,
  TaskMetaItem,
  LlmEndpointConfig,
  TtsEndpointConfig,
  WorkspaceData,
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

const LLM_PRESETS = [
  { label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: 'Azure OpenAI', provider: 'azure', baseUrl: '', model: '' },
  { label: 'Google Gemini', provider: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-pro' },
  { label: 'Anthropic Claude', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20240620' },
  { label: '硅基流动 (SiliconFlow)', provider: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { label: '自定义 (Custom)', provider: 'openai', baseUrl: '', model: '' },
];

const TTS_PRESETS = [
  { label: 'Edge TTS (免费)', provider: 'edge', ttsModel: 'edge-local', baseUrl: '', salesVoice: 'zh-CN-YunxiNeural', customerVoice: 'zh-CN-XiaoxiaoNeural' },
  { label: 'OpenAI TTS', provider: 'openai', ttsModel: 'tts-1', baseUrl: 'https://api.openai.com/v1', salesVoice: 'alloy', customerVoice: 'nova' },
  { label: '火山引擎 (ByteDance)', provider: 'volc', ttsModel: '', baseUrl: '', salesVoice: 'zh_female_shuangma_base_24k', customerVoice: 'zh_male_yaoguang_base_24k' },
  { label: '自定义 (Custom)', provider: 'custom', ttsModel: '', baseUrl: '', salesVoice: '', customerVoice: '' },
];

const NAV_ITEMS = [
  { id: 'generate', label: '生成对话', icon: '📝', description: '基于 AI 模拟销售对话场景' },
  { id: 'audio', label: '音频管理', icon: '🎵', description: '预览、播放并导出生成的音频' },
  { id: 'llm', label: 'LLM 配置', icon: '🤖', description: '管理大语言模型 API 终端' },
  { id: 'tts', label: 'TTS 配置', icon: '🗣️', description: '管理语音合成服务商信息' },
] as const;

// Main App Component
export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [activeNav, setActiveNav] = useState<NavigationItemId>('generate');
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [audioFiles, setAudioFiles] = useState<AudioFileItem[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [configSaveState, setConfigSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [configLoaded, setConfigLoaded] = useState(false);

  // Stats / Task Info
  const taskInfo: TaskMetaItem[] = [
    { label: '语速估算', value: '240 字/分' },
    { label: '分析深度', value: '42 项指标' },
  ];

  // Lifecycle
  useEffect(() => {
    async function load() {
      try {
        const workspace = await invoke<WorkspaceData>('load_workspace');
        setConfig(workspace.config);
      } catch (err) {
        console.error(err);
      } finally {
        setConfigLoaded(true);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!configLoaded) {
      return;
    }

    setConfigSaveState('idle');
  }, [config, configLoaded]);

  async function handleSaveConfig() {
    if (!configLoaded) {
      return;
    }

    setConfigSaveState('saving');
    try {
      const savedConfig = await invoke<AppConfig>('save_config', { config });
      setConfig(savedConfig);
      setConfigSaveState('success');
    } catch (err) {
      console.error(err);
      setConfigSaveState('error');
    }
  }

  // Actions
  async function handleGenerateConversation(params: any) {
    setBusy(true);
    setTranscript([]);
    setAnalysis(null);
    try {
      const result = await invoke<any>('generate_conversation', { params });
      setTranscript(result.segments);
      setAnalysis(result.analysis);
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

  const activeLlm = config.llmEndpoints.find(e => e.id === config.activeLlmId);
  const canGenerate = Boolean(activeLlm?.apiKey && activeLlm?.baseUrl && activeLlm?.model);

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
            analysis={analysis}
            taskInfo={taskInfo}
            audioFiles={audioFiles}
            playingId={playingId}
            onPlay={handlePlay}
            onGenerateConv={handleGenerateConversation}
            onGenerateAudio={handleGenerateAudio}
            onSaveConfig={handleSaveConfig}
            configSaveState={configSaveState}
            busy={busy}
            canGenerate={canGenerate}
          />
        </main>
      </div>
    </div>
  );
}

function Sidebar({ activeNav, onNavChange }: { activeNav: string; onNavChange: (id: NavigationItemId) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-logo">🎙</div>
        <span className="brand-title">SALES AUDIO</span>
      </div>

      <nav className="nav-list nav-list--primary">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavChange(item.id as NavigationItemId)}
            className={`nav-item ${activeNav === item.id ? 'is-active' : ''}`}
          >
            <div className="nav-item__icon">{item.icon}</div>
            <div className="nav-item__body">
              <div className="nav-item__title-row">
                <span className="nav-item__label">{item.label}</span>
              </div>
              <span className="nav-item__desc">{item.description}</span>
            </div>
          </button>
        ))}
      </nav>

      <div className="sidebar-status-card sidebar-status-card--compact">
        <div className="sidebar-status-row">
          <span className="status-dot status-dot--ready"></span>
          <span className="status-text">系统就绪</span>
        </div>
      </div>
    </aside>
  );
}

function MainContent({ activeNav, config, setConfig, transcript, analysis, taskInfo, audioFiles, playingId, onPlay, onGenerateConv, onGenerateAudio, onSaveConfig, configSaveState, busy, canGenerate }: any) {
  switch (activeNav) {
    case 'generate':
      return <GeneratePage transcript={transcript} analysis={analysis} taskInfo={taskInfo} onGenerate={onGenerateConv} onGenerateAudio={onGenerateAudio} busy={busy} canGenerate={canGenerate} />;
    case 'audio':
      return (
        <div className="page-view flex-col animate-fade-in">
          <StorageHeader config={config} setConfig={setConfig} />
          <AudioPage audioFiles={audioFiles} playingId={playingId} onPlay={onPlay} busy={busy} />
        </div>
      );
    case 'llm':
      return <LlmConfigPage config={config} setConfig={setConfig} onSaveConfig={onSaveConfig} configSaveState={configSaveState} />;
    case 'tts':
      return <TtsConfigPage config={config} setConfig={setConfig} onSaveConfig={onSaveConfig} configSaveState={configSaveState} />;
    default:
      return <div className="p-20 text-center text-gray-400">模块开发中...</div>;
  }
}

function GeneratePage({ transcript, analysis, taskInfo, onGenerate, onGenerateAudio, busy, canGenerate }: any) {
  const [form, setForm] = useState({
    industry: '金融保险',
    scenario: '新抢单续保提醒',
    customerRole: '犹豫不决的客户',
    tone: '专业且亲和',
    rounds: 6
  });

  const recordingState = busy ? 'processing' : (transcript.length > 0 ? 'done' : 'idle');

  return (
    <div className="page-stage">
      <header className="page-stage__header">
        <div className="section-heading compact">
          <h2>智能生成对话</h2>
          <p>配置右侧参数并由 AI 模拟真实销售场景</p>
        </div>
      </header>

      <div className="page-stage__grid page-stage__grid--split">
        <div className="card-base conversation-layout overflow-hidden">
          <TranscriptPanel transcript={transcript} recordingState={recordingState} />
        </div>

        <div className="flex-col gap-3 min-h-0 overflow-hidden">
          <section className="card-base p-4 refined-radius-panel soft-panel shadow-sm">
            <div className="section-heading compact mb-4">
              <h3>场景参数配置</h3>
            </div>
            <div className="space-y-4">
              <div className="field-block">
                <label>所属行业</label>
                <input className="field-control" value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} />
              </div>
              <div className="field-block">
                <label>对话场景</label>
                <textarea className="field-control h-20" value={form.scenario} onChange={e => setForm({ ...form, scenario: e.target.value })} />
              </div>
              <button
                className="primary-button w-full mt-4"
                onClick={() => onGenerate(form)}
                disabled={busy || !canGenerate}
              >
                {busy ? '脑力激荡中...' : '开始生成对话'}
              </button>
            </div>
          </section>

          <div className="card-base flex-1 flex flex-col overflow-hidden">
            <AnalysisPanel analysis={analysis} recordingState={recordingState} />
            {transcript.length > 0 && (
              <div className="p-4 border-t bg-gray-50/50">
                <button className="success-button w-full" onClick={onGenerateAudio} disabled={busy}>同步合成本地音频</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AudioPage({ audioFiles, playingId, onPlay, busy }: any) {
  return (
    <div className="audio-list-container animate-slide-up mt-6">
      {audioFiles.length > 0 ? (
        <div className="grid grid-cols-1 gap-3">
          {audioFiles.map((file: any) => (
            <div key={file.id} className={`audio-row-item glass-panel ${playingId === file.id ? 'is-playing' : ''}`}>
              <div className="flex items-center gap-4 px-6 py-4">
                <button className="play-toggle" onClick={() => onPlay(file.id)}>
                  {playingId === file.id ? '⏸' : '▶'}
                </button>
                <div className="flex-1">
                  <div className="font-medium">{file.title}</div>
                  <div className="text-xs text-gray-500 font-mono">{file.fileName}</div>
                </div>
                <div className="text-sm font-mono">{file.duration}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state py-20">
          <p className="text-gray-400">目前暂无已生成的音频，请先前往“生成对话”页进行合成</p>
        </div>
      )}
    </div>
  );
}

function StorageHeader({ config, setConfig }: { config: AppConfig, setConfig: any }) {
  async function pickPath() {
    const path = await invoke<string>('pick_path', { kind: 'directory' });
    if (path) setConfig((prev: any) => ({ ...prev, audioDir: path }));
  }

  return (
    <div className="storage-card glass-panel p-4 refined-radius">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-bold">本地存储配置</h3>
          <p className="text-sm text-gray-500">生成的所有音频文件都将保存在此目录下</p>
        </div>
        <button className="primary-button" onClick={pickPath}>更改目录</button>
      </div>
      <div className="path-display bg-gray-100/50 p-2 rounded text-sm font-mono">
        {config.audioDir || '未选择存储路径'}
      </div>
    </div>
  );
}

function LlmConfigPage({ config, setConfig, onSaveConfig, configSaveState }: { config: AppConfig, setConfig: any, onSaveConfig: () => Promise<void>, configSaveState: 'idle' | 'saving' | 'success' | 'error' }) {
  const activeEndpoint = config.llmEndpoints.find((e) => e.id === config.activeLlmId);
  const [loadingModels, setLoadingModels] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelOptionsByEndpoint, setModelOptionsByEndpoint] = useState<Record<string, string[]>>({});
  const [modelFetchDialog, setModelFetchDialog] = useState<{
    tone: 'success' | 'error' | 'info';
    title: string;
    text: string;
    mode: 'loading' | 'result';
  } | null>(null);

  const currentPreset =
    activeEndpoint &&
    (LLM_PRESETS.find(
      p =>
        p.provider === activeEndpoint.provider &&
        p.baseUrl === activeEndpoint.baseUrl &&
        p.model === activeEndpoint.model
    ) || LLM_PRESETS.find(p => p.label === '自定义 (Custom)'));

  const modelOptions = useMemo(() => {
    if (!activeEndpoint) {
      return [];
    }
    return modelOptionsByEndpoint[activeEndpoint.id] ?? [];
  }, [activeEndpoint, modelOptionsByEndpoint]);

  const isTitleLocked =
    !!activeEndpoint &&
    LLM_PRESETS.some(
      p =>
        p.provider === activeEndpoint.provider &&
        p.baseUrl === activeEndpoint.baseUrl &&
        p.model === activeEndpoint.model &&
        p.label !== '自定义 (Custom)'
    );

  const allowBaseUrlEdit =
    !!activeEndpoint &&
    (!!currentPreset && (currentPreset.label === '自定义 (Custom)' || currentPreset.provider === 'azure'));

  async function fetchModels() {
    if (!activeEndpoint) {
      return;
    }

    if (!activeEndpoint.apiKey.trim()) {
      setModelFetchDialog({
        tone: 'error',
        title: '缺少 API Key',
        text: '请先填写有效的 API Key，再获取模型列表。',
        mode: 'result',
      });
      return;
    }

    setLoadingModels(true);
    setModelFetchDialog({
      tone: 'info',
      title: '正在获取模型',
      text: '正在请求模型列表，请稍候…',
      mode: 'loading',
    });

    try {
      const options = await invoke<Array<{label: string; value: string; badge?: string}>>('list_llm_models', { config });
      const list = Array.isArray(options) ? options.map(o => o?.value || o?.label).filter(Boolean) : [];
      const uniq = Array.from(new Set(list));

      setModelOptionsByEndpoint(prev => ({
        ...prev,
        [activeEndpoint.id]: uniq,
      }));

      if (uniq.length > 0) {
        const nextModel = uniq.includes(activeEndpoint.model) ? activeEndpoint.model : uniq[0];
        updateEndpoint(activeEndpoint.id, { model: nextModel });
        setModelMenuOpen(true);
        setModelFetchDialog({
          tone: 'success',
          title: '获取成功',
          text: `共获取到 ${uniq.length} 个模型，已自动切换为可下拉选择。`,
          mode: 'result',
        });
      } else {
        setModelMenuOpen(false);
        setModelFetchDialog({
          tone: 'error',
          title: '未返回可用模型',
          text: '接口请求成功，但没有返回可选模型，请检查当前供应商是否支持模型列表接口。',
          mode: 'result',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const friendlyMessage =
        message.includes('/models') || message.includes('模型列表接口')
          ? `当前供应商暂不兼容标准 /models 接口，或返回格式不符合预期。\n\n详细信息：${message}`
          : message;

      setModelMenuOpen(false);
      setModelFetchDialog({
        tone: 'error',
        title: '获取失败',
        text: friendlyMessage,
        mode: 'result',
      });
    } finally {
      setLoadingModels(false);
    }
  }
  
  function setActiveLlmId(id: string) {
    setConfig((prev: AppConfig) => ({ ...prev, activeLlmId: id }));
  }

  function updateEndpoint(id: string, partial: Partial<LlmEndpointConfig>) {
    setConfig((prev: AppConfig) => ({
      ...prev,
      llmEndpoints: prev.llmEndpoints.map(e => e.id === id ? { ...e, ...partial } : e)
    }));
  }

  useEffect(() => {
    if (!activeEndpoint) {
      setModelFetchDialog(null);
      setModelMenuOpen(false);
      return;
    }

    setModelFetchDialog(null);
    setModelMenuOpen(false);
  }, [activeEndpoint?.id]);

  function addEndpoint() {
    const newId = `llm-${Date.now()}`;
    const newEp: LlmEndpointConfig = {
      id: newId,
      title: '新配置 ' + (config.llmEndpoints.length + 1),
      provider: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    };
    setConfig((prev: AppConfig) => ({
      ...prev,
      llmEndpoints: [...prev.llmEndpoints, newEp],
      activeLlmId: newId
    }));
  }

  function deleteEndpoint(id: string) {
    setConfig((prev: AppConfig) => {
      const next = prev.llmEndpoints.filter((e) => e.id !== id);
      return {
        ...prev,
        llmEndpoints: next,
        activeLlmId: prev.activeLlmId === id ? (next.length > 0 ? next[0].id : '') : prev.activeLlmId,
      };
    });
  }

  return (
    <div className="layout-split animate-slide-up">
      <aside className="sub-sidebar">
        <div className="sub-sidebar__header">LLM 端点列表库</div>
        <button className="add-button" onClick={addEndpoint}>
          <span style={{ fontSize: '16px' }}>＋</span> 新增配置
        </button>
        <div className="sub-sidebar__list">
          {config.llmEndpoints.map((ep: LlmEndpointConfig) => (
            <div
              key={ep.id}
              className={`sub-nav-item ${config.activeLlmId === ep.id ? 'is-active' : ''}`}
              onClick={() => setActiveLlmId(ep.id)}
            >
              <span>{ep.title}</span>
              <button className="del-btn" onClick={(e) => { e.stopPropagation(); deleteEndpoint(ep.id); }}>×</button>
            </div>
          ))}
        </div>
      </aside>

      <section className="form-content">
                {!activeEndpoint ? (
          <ConfigPlaceholder message="请选择或新增端点配置" />
        ) : (
          <div className="config-page-card animate-fade-in">
            <div className="config-form-wrapper">
              <div className="config-section-header">
                <div className="field-block" style={{ flex: 1 }}>
                  <label>预设供应商</label>
                  <div 
                    className="preset-wrapper"
                    onMouseEnter={() => setPresetOpen(true)}
                    onMouseLeave={() => setPresetOpen(false)}
                  >
                    <div
                      className={`preset-trigger ${presetOpen ? 'is-open' : ''}`}
                      onClick={() => setPresetOpen(v => !v)} // 点击也能开关
                    >
                      <span className="preset-trigger__text">
                        {currentPreset?.label || '自定义 (Custom)'}
                      </span>
                      <span className="preset-trigger__arrow">▾</span>
                    </div>

                    <div
                      className="preset-menu"
                      style={{ display: presetOpen ? 'block' : 'none' }}
                    >
                      {LLM_PRESETS.map(p => {
                        const active =
                          p.provider === currentPreset?.provider &&
                          p.baseUrl === currentPreset?.baseUrl &&
                          p.model === currentPreset?.model &&
                          p.label === currentPreset?.label;

                        return (
                          <button
                            key={p.label}
                            type="button"
                            className={`preset-menu__item ${active ? 'is-active' : ''}`}
                            onMouseDown={() => { // 用 onMouseDown 更稳，不怕先失焦
                              updateEndpoint(activeEndpoint.id, {
                                title: p.label === '自定义 (Custom)' ? '新接入点' : p.label,
                                provider: p.provider,
                                baseUrl: p.baseUrl,
                                model: p.model,
                              });
                              setModelFetchDialog(null);
                              setModelMenuOpen(false);
                              setPresetOpen(false);
                            }}
                          >
                            <span className="preset-menu__label">{p.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-8">
                <div className="group-card">
                  <div className="config-grid-2">
                    <div className="field-block">
                      <label>供应商名称</label>
                      <input
                        className="field-control"
                        value={activeEndpoint.title}
                        disabled={isTitleLocked}
                        onChange={e =>
                          updateEndpoint(activeEndpoint.id, { title: e.target.value })
                        }
                        placeholder="例如：OpenAI 官方"
                      />
                    </div>
                    <div className="field-block">
                      <label>备注</label>
                      <input
                        className="field-control"
                        placeholder="例如：生产环境专用 Key"
                      />
                    </div>
                  </div>
                </div>

                <div className="group-card">
                  <div className="field-block">
                    <label>API Key</label>
                    <input
                      className="field-control"
                      type="password"
                      value={activeEndpoint.apiKey}
                      onChange={e =>
                        updateEndpoint(activeEndpoint.id, { apiKey: e.target.value })
                      }
                      placeholder="只需在此填写，下方配置会自动填充"
                    />
                  </div>

                  <div className="field-block" style={{ marginTop: 12 }}>
                    <label>Base URL / 请求地址</label>
                    <input
                      className="field-control"
                      value={activeEndpoint.baseUrl}
                      disabled={!allowBaseUrlEdit}
                      onChange={e =>
                        updateEndpoint(activeEndpoint.id, { baseUrl: e.target.value })
                      }
                      placeholder={currentPreset?.provider === 'azure' ? 'https://{resource}.openai.azure.com' : 'https://your-api-endpoint.com'}
                    />
                  </div>

                  <div className="field-block" style={{ marginTop: 12 }}>
                    <div className="field-inline-header">
                      <label>部署模型 / Model ID</label>
                      <button
                        className="chip-button strong-secondary"
                        style={{ padding: '4px 10px', fontSize: 11, whiteSpace: 'nowrap' }}
                        onClick={fetchModels}
                        disabled={loadingModels}
                      >
                        {loadingModels ? '获取中…' : '获取模型'}
                      </button>
                    </div>
                    {modelOptions.length > 0 ? (
                      <div
                        className="preset-wrapper"
                        onMouseEnter={() => setModelMenuOpen(true)}
                        onMouseLeave={() => setModelMenuOpen(false)}
                      >
                        <div
                          className={`preset-trigger ${modelMenuOpen ? 'is-open' : ''}`}
                          onClick={() => setModelMenuOpen(v => !v)}
                        >
                          <span className="preset-trigger__text">
                            {activeEndpoint.model || '请选择模型'}
                          </span>
                          <span className="preset-trigger__arrow">▾</span>
                        </div>

                        <div
                          className="preset-menu"
                          style={{ display: modelMenuOpen ? 'block' : 'none' }}
                        >
                          {modelOptions.map(m => {
                            const active = m === activeEndpoint.model;
                            return (
                              <button
                                key={m}
                                type="button"
                                className={`preset-menu__item ${active ? 'is-active' : ''}`}
                                onMouseDown={() => {
                                  updateEndpoint(activeEndpoint.id, { model: m });
                                  setModelMenuOpen(false);
                                }}
                              >
                                <span className="preset-menu__label">{m}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <input
                        className="field-control flex-1"
                        value={activeEndpoint.model}
                        onChange={e =>
                          updateEndpoint(activeEndpoint.id, { model: e.target.value })
                        }
                        placeholder="gpt-4o"
                      />
                    )}
                  </div>
                </div>

                <div className="flex justify-center pt-10">
                  <button className="btn-save" onClick={onSaveConfig} disabled={configSaveState === 'saving'}>
                    {configSaveState === 'saving' ? '保存中...' : configSaveState === 'success' ? '已保存' : configSaveState === 'error' ? '保存失败，请重试' : '保存配置'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {modelFetchDialog ? (
        <div
          className="dialog-overlay"
          onClick={modelFetchDialog.mode === 'result' ? () => setModelFetchDialog(null) : undefined}
        >
          <div className="dialog-card" onClick={e => e.stopPropagation()}>
            <div className={`dialog-badge dialog-badge--${modelFetchDialog.tone}`}>
              {modelFetchDialog.tone === 'success' ? '成功' : modelFetchDialog.tone === 'info' ? '提示' : '错误'}
            </div>
            <div className="dialog-title">{modelFetchDialog.title}</div>
            <div className="dialog-text">
              {modelFetchDialog.mode === 'loading' ? (
                <span className="dialog-loading-inline">
                  <span className="dialog-loading-spinner" aria-hidden="true" />
                  <span>{modelFetchDialog.text}</span>
                </span>
              ) : (
                modelFetchDialog.text
              )}
            </div>
            {modelFetchDialog.mode === 'result' ? (
              <div className="dialog-actions">
                <button className="chip-button is-active" onClick={() => setModelFetchDialog(null)}>
                  我知道了
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TtsConfigPage({ config, setConfig, onSaveConfig, configSaveState }: { config: AppConfig, setConfig: any, onSaveConfig: () => Promise<void>, configSaveState: 'idle' | 'saving' | 'success' | 'error' }) {
  const activeEndpoint = config.ttsEndpoints.find((e: any) => e.id === config.activeTtsId);

  // 侧边栏操作（保持与你现有逻辑一致）
  function setActiveTtsId(id: string) {
    setConfig((prev: AppConfig) => ({ ...prev, activeTtsId: id }));
  }

  function updateEndpoint(id: string, partial: Partial<TtsEndpointConfig>) {
    setConfig((prev: AppConfig) => ({
      ...prev,
      ttsEndpoints: prev.ttsEndpoints.map(e => e.id === id ? { ...e, ...partial } : e)
    }));
  }

  function addEndpoint() {
    const newId = `tts-${Date.now()}`;
    const newEp: TtsEndpointConfig = {
      id: newId,
      title: '新发音节点 ' + (config.ttsEndpoints.length + 1),
      provider: 'edge',
      apiKey: '',
      baseUrl: '',
      ttsModel: 'edge-local',
      salesVoice: 'zh-CN-YunxiNeural',
      customerVoice: 'zh-CN-XiaoxiaoNeural',
    };
    setConfig((prev: AppConfig) => ({
      ...prev,
      ttsEndpoints: [...prev.ttsEndpoints, newEp],
      activeTtsId: newId
    }));
  }

  function deleteEndpoint(id: string) {
    setConfig((prev: AppConfig) => {
      const next = prev.ttsEndpoints.filter((e) => e.id !== id);
      return {
        ...prev,
        ttsEndpoints: next,
        activeTtsId: prev.activeTtsId === id ? (next.length > 0 ? next[0].id : '') : prev.activeTtsId,
      };
    });
  }

  // 预设下拉（自绘）
  const [presetOpen, setPresetOpen] = useState(false);

  const currentPreset =
    activeEndpoint &&
    (TTS_PRESETS.find(
      p =>
        p.provider === activeEndpoint.provider &&
        p.baseUrl === activeEndpoint.baseUrl &&
        p.ttsModel === activeEndpoint.ttsModel
    ) || TTS_PRESETS.find(p => p.label === '自定义 (Custom)'));

  // 非自定义时锁定服务名称；Base URL 默认只有自定义允许编辑（如需对特定厂商放开可按需扩展）
  const isTitleLocked =
    !!activeEndpoint &&
    TTS_PRESETS.some(
      p =>
        p.provider === activeEndpoint.provider &&
        p.baseUrl === activeEndpoint.baseUrl &&
        p.ttsModel === activeEndpoint.ttsModel &&
        p.label !== '自定义 (Custom)'
    );

  const allowBaseUrlEdit =
    !!activeEndpoint &&
    (!!currentPreset && currentPreset.label === '自定义 (Custom)');

  return (
    <div className="layout-split animate-slide-up">
      <aside className="sub-sidebar">
        <div className="sub-sidebar__header">TTS 端点列表库</div>
        <button className="add-button" onClick={addEndpoint}>
          <span style={{ fontSize: '16px' }}>＋</span> 新增发音节点
        </button>
        <div className="sub-sidebar__list">
          {config.ttsEndpoints.map((ep: TtsEndpointConfig) => (
            <div
              key={ep.id}
              className={`sub-nav-item ${config.activeTtsId === ep.id ? 'is-active' : ''}`}
              onClick={() => setActiveTtsId(ep.id)}
            >
              <span>{ep.title}</span>
              <button className="del-btn" onClick={(e) => { e.stopPropagation(); deleteEndpoint(ep.id); }}>×</button>
            </div>
          ))}
        </div>
      </aside>

      <section className="form-content">
        {!activeEndpoint ? (
          <ConfigPlaceholder message="请选择或新增TTS配置" />
        ) : (
          <div className="config-page-card animate-fade-in">
            <div className="config-form-wrapper">

              {/* 预设服务商（自绘下拉） */}
              <div className="config-section-header">
                <div className="field-block" style={{ flex: 1 }}>
                  <label>预设服务商</label>
                  <div
                    className="preset-wrapper"
                    onMouseEnter={() => setPresetOpen(true)}
                    onMouseLeave={() => setPresetOpen(false)}
                  >
                    <div
                      className={`preset-trigger ${presetOpen ? 'is-open' : ''}`}
                      onClick={() => setPresetOpen(v => !v)}
                    >
                      <span className="preset-trigger__text">
                        {currentPreset?.label || '自定义 (Custom)'}
                      </span>
                      <span className="preset-trigger__arrow">▾</span>
                    </div>

                    <div
                      className="preset-menu"
                      style={{ display: presetOpen ? 'block' : 'none' }}
                    >
                      {TTS_PRESETS.map(p => {
                        const active =
                          p.provider === currentPreset?.provider &&
                          p.baseUrl === currentPreset?.baseUrl &&
                          p.ttsModel === currentPreset?.ttsModel &&
                          p.label === currentPreset?.label;

                        return (
                          <button
                            key={p.label}
                            type="button"
                            className={`preset-menu__item ${active ? 'is-active' : ''}`}
                            onMouseDown={() => {
                              updateEndpoint(activeEndpoint.id, {
                                title: p.label === '自定义 (Custom)' ? '新语音服务' : p.label,
                                provider: p.provider as any,
                                baseUrl: p.baseUrl,
                                ttsModel: p.ttsModel,
                                salesVoice: p.salesVoice,
                                customerVoice: p.customerVoice
                              });
                              setPresetOpen(false);
                            }}
                          >
                            <span className="preset-menu__label">{p.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* 表单主体 */}
              <div className="space-y-8">
                <div className="group-card">
                  <div className="config-grid-2">
                    <div className="field-block">
                      <label>服务名称</label>
                      <input
                        className="field-control"
                        value={activeEndpoint.title}
                        disabled={isTitleLocked}
                        onChange={e => updateEndpoint(activeEndpoint.id, { title: e.target.value })}
                        placeholder="例如：Edge TTS 本地"
                      />
                    </div>
                    <div className="field-block">
                      <label>备注</label>
                      <input
                        className="field-control"
                        placeholder="例如：测试环境"
                      />
                    </div>
                  </div>
                </div>

                <div className="group-card">
                  <div className="config-grid-2">
                    <div className="field-block">
                      <label>API Key (可选)</label>
                      <input
                        className="field-control"
                        type="password"
                        value={activeEndpoint.apiKey}
                        onChange={e => updateEndpoint(activeEndpoint.id, { apiKey: e.target.value })}
                        placeholder="sk-..."
                      />
                    </div>
                    <div className="field-block">
                      <label>Base URL / 接入点</label>
                      <input
                        className="field-control"
                        value={activeEndpoint.baseUrl}
                        disabled={!allowBaseUrlEdit}
                        onChange={e => updateEndpoint(activeEndpoint.id, { baseUrl: e.target.value })}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                </div>

                <div className="group-card">
                  <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <div className="group-card__title" style={{ marginBottom: 0 }}>角色配音设定</div>
                    <button
                      className="chip-button strong-secondary"
                      style={{ padding: '4px 10px', fontSize: 11, whiteSpace: 'nowrap' }}
                      onClick={() => { /* TODO: 获取音色列表（如有接口） */ }}
                      disabled={false}
                    >
                      获取音色
                    </button>
                  </div>
                  <div className="config-grid-2">
                    <div className="field-block">
                      <label>销售角色音色 ID</label>
                      <input
                        className="field-control"
                        value={activeEndpoint.salesVoice}
                        onChange={e => updateEndpoint(activeEndpoint.id, { salesVoice: e.target.value })}
                      />
                    </div>
                    <div className="field-block">
                      <label>客户角色音色 ID</label>
                      <input
                        className="field-control"
                        value={activeEndpoint.customerVoice}
                        onChange={e => updateEndpoint(activeEndpoint.id, { customerVoice: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-center pt-10">
                  <button className="btn-save" onClick={onSaveConfig} disabled={configSaveState === 'saving'}>
                    {configSaveState === 'saving' ? '保存中...' : configSaveState === 'success' ? '已保存' : configSaveState === 'error' ? '保存失败，请重试' : '保存配置'}
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ConfigPlaceholder({ message }: { message: string }) {
  return (
    <div className="placeholder-empty">
      <div className="placeholder-icon">⚙️</div>
      <div className="text-xl font-black text-gray-300 tracking-tight">{message}</div>
      <div className="mt-4 text-xs text-gray-400 font-medium bg-gray-50 px-4 py-2 rounded-full">所有的改动都将即时同步至本地工作区</div>
    </div>
  );
}
