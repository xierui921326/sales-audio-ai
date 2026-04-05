import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ConfigPlaceholder from '../components/config/ConfigPlaceholder';
import { AppConfig, LlmEndpointConfig } from '../types';

const LLM_PRESETS = [
  { label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: 'Azure OpenAI', provider: 'azure', baseUrl: '', model: '' },
  { label: 'Google Gemini', provider: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-pro' },
  { label: 'Anthropic Claude', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20240620' },
  { label: '硅基流动 (SiliconFlow)', provider: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { label: '自定义 (Custom)', provider: 'openai', baseUrl: '', model: '' },
] as const;

interface LlmConfigPageProps {
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  onSaveConfig: () => Promise<void>;
  configSaveState: 'idle' | 'saving' | 'success' | 'error';
}

export default function LlmConfigPage({ config, setConfig, onSaveConfig, configSaveState }: LlmConfigPageProps) {
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
      const options = await invoke<Array<{ label: string; value: string; badge?: string }>>('list_llm_models', { config });
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
    setConfig((prev) => ({ ...prev, activeLlmId: id }));
  }

  function updateEndpoint(id: string, partial: Partial<LlmEndpointConfig>) {
    setConfig((prev) => ({
      ...prev,
      llmEndpoints: prev.llmEndpoints.map(e => e.id === id ? { ...e, ...partial } : e),
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
    setConfig((prev) => ({
      ...prev,
      llmEndpoints: [...prev.llmEndpoints, newEp],
      activeLlmId: newId,
    }));
  }

  function deleteEndpoint(id: string) {
    setConfig((prev) => {
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
        <button className="add-button" onClick={addEndpoint} type="button">
          <span className="icon-shape icon-shape--plus" aria-hidden="true" />
          <span>新增配置</span>
        </button>
        <div className="sub-sidebar__list">
          {config.llmEndpoints.map((ep) => (
            <div
              key={ep.id}
              className={`sub-nav-item ${config.activeLlmId === ep.id ? 'is-active' : ''}`}
              onClick={() => setActiveLlmId(ep.id)}
            >
              <span>{ep.title}</span>
              <button className="del-btn" type="button" onClick={(e) => { e.stopPropagation(); deleteEndpoint(ep.id); }}>
                <span className="icon-shape icon-shape--close" aria-hidden="true" />
              </button>
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
                <div className="field-block config-section-header__field-block">
                  <label>预设供应商</label>
                  <div
                    className="preset-wrapper"
                    onMouseEnter={() => setPresetOpen(true)}
                    onMouseLeave={() => setPresetOpen(false)}
                  >
                    <button
                      type="button"
                      className={`preset-trigger ${presetOpen ? 'is-open' : ''}`}
                      onClick={() => setPresetOpen(v => !v)}
                    >
                      <span className="preset-trigger__text">
                        {currentPreset?.label || '自定义 (Custom)'}
                      </span>
                      <span className="preset-trigger__arrow" aria-hidden="true">
                        <span className="icon-shape icon-shape--chevron" />
                      </span>
                    </button>

                    <div className="preset-menu" style={{ display: presetOpen ? 'block' : 'none' }}>
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
                            onMouseDown={() => {
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

              <div className="config-form-stack">
                <div className="group-card">
                  <div className="config-grid-2">
                    <div className="field-block">
                      <label>供应商名称</label>
                      <input
                        className="field-control"
                        value={activeEndpoint.title}
                        disabled={isTitleLocked}
                        onChange={e => updateEndpoint(activeEndpoint.id, { title: e.target.value })}
                        placeholder="例如：OpenAI 官方"
                      />
                    </div>
                    <div className="field-block">
                      <label>备注</label>
                      <input className="field-control" placeholder="例如：生产环境专用 Key" />
                    </div>
                  </div>
                </div>

                <div className="group-card config-form-stack__group-card">
                  <div className="field-block">
                    <label>API Key</label>
                    <input
                      className="field-control"
                      type="password"
                      value={activeEndpoint.apiKey}
                      onChange={e => updateEndpoint(activeEndpoint.id, { apiKey: e.target.value })}
                      placeholder="只需在此填写，下方配置会自动填充"
                    />
                  </div>

                  <div className="field-block config-field-offset">
                    <label>Base URL / 请求地址</label>
                    <input
                      className="field-control"
                      value={activeEndpoint.baseUrl}
                      disabled={!allowBaseUrlEdit}
                      onChange={e => updateEndpoint(activeEndpoint.id, { baseUrl: e.target.value })}
                      placeholder={currentPreset?.provider === 'azure' ? 'https://{resource}.openai.azure.com' : 'https://your-api-endpoint.com'}
                    />
                  </div>

                  <div className="field-block config-field-offset">
                    <div className="field-inline-header">
                      <label>部署模型 / Model ID</label>
                      <button
                        className="chip-button strong-secondary compact-chip-button"
                        type="button"
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
                        <button
                          type="button"
                          className={`preset-trigger ${modelMenuOpen ? 'is-open' : ''}`}
                          onClick={() => setModelMenuOpen(v => !v)}
                        >
                          <span className="preset-trigger__text">
                            {activeEndpoint.model || '请选择模型'}
                          </span>
                          <span className="preset-trigger__arrow" aria-hidden="true">
                            <span className="icon-shape icon-shape--chevron" />
                          </span>
                        </button>

                        <div className="preset-menu" style={{ display: modelMenuOpen ? 'block' : 'none' }}>
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
                        className="field-control"
                        value={activeEndpoint.model}
                        onChange={e => updateEndpoint(activeEndpoint.id, { model: e.target.value })}
                        placeholder="gpt-4o"
                      />
                    )}
                  </div>
                </div>

                <div className="config-save-row">
                  <button className="btn-save" onClick={onSaveConfig} disabled={configSaveState === 'saving'} type="button">
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
                <button className="chip-button is-active" onClick={() => setModelFetchDialog(null)} type="button">
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
