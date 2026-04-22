import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Dialog from '../components/Dialog';
import ConfigPlaceholder from '../components/config/ConfigPlaceholder';
import ConfigSelect from '../components/config/ConfigSelect';
import { logger } from '../utils/logger';
import { AppConfig, LlmEndpointConfig } from '../types';

const LLM_PRESETS = [
  { label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: '千问 Qwen', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
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
  savedConfigSnapshot: AppConfig;
  onSaveConfig: () => Promise<void>;
  configSaveState: 'idle' | 'saving' | 'success' | 'error';
  hasUnsavedChanges: boolean;
}

export default function LlmConfigPage({ config, setConfig, savedConfigSnapshot, onSaveConfig, configSaveState, hasUnsavedChanges }: LlmConfigPageProps) {
  // 配置页负责维护“默认 LLM”，生成页里的下拉只影响当前这一次生成任务。
  const [selectedEndpointId, setSelectedEndpointId] = useState(config.activeLlmId || config.llmEndpoints[0]?.id || '');
  const activeEndpoint = config.llmEndpoints.find((e) => e.id === selectedEndpointId);
  const defaultEndpointId = config.activeLlmId;
  const savedDefaultEndpointId = savedConfigSnapshot.activeLlmId;
  const supplierLocked = savedConfigSnapshot.llmEndpoints.some(e => e.id === selectedEndpointId);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelOptionsByEndpoint, setModelOptionsByEndpoint] = useState<Record<string, string[]>>({});
  const [modelFetchDialog, setModelFetchDialog] = useState<{
    tone: 'success' | 'error' | 'info';
    title: string;
    text: string;
    mode: 'loading' | 'result';
  } | null>(null);

  useEffect(() => {
    setSelectedEndpointId(current => {
      if (current && config.llmEndpoints.some(endpoint => endpoint.id === current)) {
        return current;
      }
      if (config.activeLlmId && config.llmEndpoints.some(endpoint => endpoint.id === config.activeLlmId)) {
        return config.activeLlmId;
      }
      return config.llmEndpoints[0]?.id ?? '';
    });
  }, [config.activeLlmId, config.llmEndpoints]);

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
      logger.info('llm-config', '开始拉取模型列表', {
        endpointId: activeEndpoint.id,
        provider: activeEndpoint.provider,
      });
      const requestConfig = {
        ...config,
        activeLlmId: activeEndpoint.id,
      };
      // 使用当前选中的 endpoint 作为临时 activeLlmId，确保后端按目标配置请求模型列表。
      const options = await invoke<Array<{ label: string; value: string; badge?: string }>>('list_llm_models', { config: requestConfig });
      const list = Array.isArray(options) ? options.map(o => o?.value || o?.label).filter(Boolean) : [];
      const uniq = Array.from(new Set(list));
      logger.info('llm-config', '模型列表拉取完成', {
        endpointId: activeEndpoint.id,
        modelCount: uniq.length,
      });

      setModelOptionsByEndpoint(prev => ({
        ...prev,
        [activeEndpoint.id]: uniq,
      }));

      if (uniq.length > 0) {
        const nextModel = uniq.includes(activeEndpoint.model) ? activeEndpoint.model : uniq[0];
        updateEndpoint(activeEndpoint.id, { model: nextModel });
        setModelFetchDialog({
          tone: 'success',
          title: '获取成功',
          text: `共获取到 ${uniq.length} 个模型，已自动切换为可下拉选择。`,
          mode: 'result',
        });
      } else {
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

      logger.error('llm-config', '模型列表拉取失败', {
        endpointId: activeEndpoint.id,
        provider: activeEndpoint.provider,
        message,
      });

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

  function setDefaultLlmId(id: string) {
    setConfig(prev => ({ ...prev, activeLlmId: id }));
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
      return;
    }

    setModelFetchDialog(null);
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
    }));
    setSelectedEndpointId(newId);
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

    setSelectedEndpointId(current => {
      if (current !== id) {
        return current;
      }
      const next = config.llmEndpoints.filter((e) => e.id !== id);
      if (config.activeLlmId && config.activeLlmId !== id && next.some(endpoint => endpoint.id === config.activeLlmId)) {
        return config.activeLlmId;
      }
      return next[0]?.id ?? '';
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
          {config.llmEndpoints.map((ep) => {
            const isSelected = selectedEndpointId === ep.id;
            const isDefault = defaultEndpointId === ep.id;

            return (
              <div
                key={ep.id}
                className={`sub-nav-item ${isSelected ? 'is-active' : ''}`}
                onClick={() => setSelectedEndpointId(ep.id)}
              >
                <div className="sub-nav-item__content">
                  <span>{ep.title}</span>
                </div>
                <div className="sub-nav-item__actions">
                  {isDefault ? <span className="sub-nav-item__badge">默认</span> : null}
                  {!isDefault && isSelected ? (
                    <button
                      className="sub-nav-item__set-default chip-button strong-secondary"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDefaultLlmId(ep.id);
                      }}
                    >
                      设为默认
                    </button>
                  ) : null}
                  <button className="del-btn" type="button" onClick={(e) => { e.stopPropagation(); deleteEndpoint(ep.id); }}>
                    <span className="icon-shape icon-shape--close" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <section className="form-content">
        {!activeEndpoint ? (
          <ConfigPlaceholder message="请选择或新增端点配置" />
        ) : (
          <div className="config-page-card animate-fade-in">
            <div className="config-form-wrapper">
              {savedDefaultEndpointId !== defaultEndpointId ? (
                <div className="field-helper-text config-default-inline-tip">默认 LLM 已变更，记得点击下方“保存配置”生效。</div>
              ) : null}

              <div className="config-section-header">
                <div className="field-block config-section-header__field-block">
                  <div className="field-inline-header config-label-inline-row">
                    <label>预设供应商</label>
                    {supplierLocked ? (
                      <span className="config-inline-warning">当前端点已保存，供应商不可更改；如需切换，请新增配置。</span>
                    ) : null}
                  </div>
                  <ConfigSelect
                    value={currentPreset?.label || '自定义 (Custom)'}
                    options={LLM_PRESETS.map(p => ({
                      value: p.label,
                      label: p.label,
                    }))}
                    onChange={(label) => {
                      const preset = LLM_PRESETS.find(p => p.label === label);
                      if (!preset) {
                        return;
                      }

                      updateEndpoint(activeEndpoint.id, {
                        title: preset.label === '自定义 (Custom)' ? '新接入点' : preset.label,
                        provider: preset.provider,
                        baseUrl: preset.baseUrl,
                        model: preset.model,
                      });
                      setModelFetchDialog(null);
                    }}
                    placeholder="自定义 (Custom)"
                    disabled={supplierLocked}
                  />
                </div>
              </div>

              <div className="config-form-stack">
                <div className="group-card">
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
                </div>

                <div className="group-card config-form-stack__group-card">
                  <div className="field-block">
                    <label>API Key</label>
                    <input
                      className="field-control"
                      type="password"
                      value={activeEndpoint.apiKey}
                      onChange={e => updateEndpoint(activeEndpoint.id, { apiKey: e.target.value })}
                      placeholder={currentPreset?.label === '千问 Qwen' ? '填写阿里云 DashScope API Key' : '只需在此填写，下方配置会自动填充'}
                    />
                  </div>

                  <div className="field-block config-field-offset">
                    <label>Base URL / 请求地址</label>
                    <input
                      className="field-control"
                      value={activeEndpoint.baseUrl}
                      disabled={!allowBaseUrlEdit}
                      onChange={e => updateEndpoint(activeEndpoint.id, { baseUrl: e.target.value })}
                      placeholder={
                        currentPreset?.provider === 'azure'
                          ? 'https://{resource}.openai.azure.com'
                          : currentPreset?.label === '千问 Qwen'
                            ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
                            : 'https://your-api-endpoint.com'
                      }
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
                      <ConfigSelect
                        value={activeEndpoint.model}
                        options={modelOptions.map(m => ({
                          value: m,
                          label: m,
                        }))}
                        onChange={(model) => {
                          updateEndpoint(activeEndpoint.id, { model });
                        }}
                        placeholder="请选择模型"
                      />
                    ) : (
                      <input
                        className="field-control"
                        value={activeEndpoint.model}
                        onChange={e => updateEndpoint(activeEndpoint.id, { model: e.target.value })}
                        placeholder={currentPreset?.label === '千问 Qwen' ? 'qwen-plus / qwen-turbo / qwen-max' : 'gpt-4o'}
                      />
                    )}
                    {currentPreset?.label === '千问 Qwen' ? (
                      <div className="field-helper-text">
                        千问默认走 DashScope 的 OpenAI 兼容接口，可直接使用 `qwen-plus`、`qwen-turbo`、`qwen-max` 等模型名。
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="config-save-row">
                  <button className="btn-save" onClick={onSaveConfig} disabled={configSaveState === 'saving'} type="button">
                    {configSaveState === 'saving' ? '保存中...' : configSaveState === 'error' ? '保存失败，请重试' : configSaveState === 'success' && !hasUnsavedChanges ? '已保存' : '保存配置'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {modelFetchDialog ? (
        <Dialog
          tone={modelFetchDialog.tone}
          title={modelFetchDialog.title}
          description={modelFetchDialog.mode === 'loading' ? (
            <span className="dialog-loading-inline">
              <span className="dialog-loading-spinner" aria-hidden="true" />
              <span>{modelFetchDialog.text}</span>
            </span>
          ) : modelFetchDialog.text}
          onClose={modelFetchDialog.mode === 'result' ? () => setModelFetchDialog(null) : undefined}
          closeOnOverlay={modelFetchDialog.mode === 'result'}
          size="compact"
          actions={modelFetchDialog.mode === 'result' ? (
            <button className="chip-button is-active" onClick={() => setModelFetchDialog(null)} type="button">
              我知道了
            </button>
          ) : null}
        />
      ) : null}
    </div>
  );
}
