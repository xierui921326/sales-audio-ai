import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ConfigPlaceholder from '../components/config/ConfigPlaceholder';
import ConfigSelect from '../components/config/ConfigSelect';
import { AppConfig, TtsEndpointConfig } from '../types';

const EDGE_TTS_VOICE_OPTIONS = [
  { value: 'zh-CN-XiaoxiaoNeural', label: 'zh-CN-XiaoxiaoNeural（男声）' },
  { value: 'zh-CN-YunjianNeural', label: 'zh-CN-YunjianNeural（女声）' },
  { value: 'zh-CN-liaoning-XiaobeiNeural', label: 'zh-CN-liaoning-XiaobeiNeural（男声）' },
  { value: 'zh-CN-shaanxi-XiaoniNeural', label: 'zh-CN-shaanxi-XiaoniNeural（男声）' },
] as const;

const TTS_PRESETS = [
  { label: 'Edge TTS (免费)', provider: 'edge', ttsModel: 'edge-local', baseUrl: '', salesVoice: 'zh-CN-XiaoxiaoNeural', customerVoice: 'zh-CN-YunjianNeural' },
  { label: '千问 TTS', provider: 'qwen', ttsModel: 'qwen-tts', baseUrl: 'http://localhost:8000', salesVoice: '', customerVoice: '' },
] as const;

interface TtsConfigPageProps {
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  savedConfigSnapshot: AppConfig;
  onSaveConfig: () => Promise<void>;
  configSaveState: 'idle' | 'saving' | 'success' | 'error';
  hasUnsavedChanges: boolean;
}

export default function TtsConfigPage({ config, setConfig, savedConfigSnapshot, onSaveConfig, configSaveState, hasUnsavedChanges }: TtsConfigPageProps) {
  const [selectedEndpointId, setSelectedEndpointId] = useState(config.activeTtsId || config.ttsEndpoints[0]?.id || '');
  const activeEndpoint = config.ttsEndpoints.find((e) => e.id === selectedEndpointId);
  const defaultEndpointId = config.activeTtsId;
  const savedDefaultEndpointId = savedConfigSnapshot.activeTtsId;
  const supplierLocked = savedConfigSnapshot.ttsEndpoints.some(e => e.id === selectedEndpointId);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voiceOptionsByEndpoint, setVoiceOptionsByEndpoint] = useState<Record<string, string[]>>({});
  const [saveDialog, setSaveDialog] = useState<{
    tone: 'error' | 'info';
    title: string;
    text: string;
  } | null>(null);
  const isEdgePreset = activeEndpoint?.provider === 'edge';
  const isQwenPreset = activeEndpoint?.provider === 'qwen';
  const edgeVoiceOptions = useMemo(() => EDGE_TTS_VOICE_OPTIONS.map(option => ({
    value: option.value,
    label: option.label,
  })), []);
  const qwenVoiceOptions = useMemo(() => {
    if (!activeEndpoint) {
      return [];
    }

    return (voiceOptionsByEndpoint[activeEndpoint.id] ?? []).map(voice => ({
      value: voice,
      label: voice,
    }));
  }, [activeEndpoint, voiceOptionsByEndpoint]);

  useEffect(() => {
    setSelectedEndpointId(current => {
      if (current && config.ttsEndpoints.some(endpoint => endpoint.id === current)) {
        return current;
      }
      if (config.activeTtsId && config.ttsEndpoints.some(endpoint => endpoint.id === config.activeTtsId)) {
        return config.activeTtsId;
      }
      return config.ttsEndpoints[0]?.id ?? '';
    });
  }, [config.activeTtsId, config.ttsEndpoints]);

  async function fetchVoices() {
    if (!activeEndpoint || !isQwenPreset) {
      return;
    }

    setLoadingVoices(true);
    try {
      const requestConfig = {
        ...config,
        activeTtsId: activeEndpoint.id,
      };
      const options = await invoke<Array<{ label: string; value: string }>>('list_tts_voices', { config: requestConfig });
      const voices = Array.isArray(options) ? options.map(option => option?.value || option?.label).filter(Boolean) : [];
      const uniq = Array.from(new Set(voices));

      setVoiceOptionsByEndpoint(prev => ({
        ...prev,
        [activeEndpoint.id]: uniq,
      }));

      if (uniq.length > 0) {
        updateEndpoint(activeEndpoint.id, {
          salesVoice: uniq.includes(activeEndpoint.salesVoice) ? activeEndpoint.salesVoice : uniq[0],
          customerVoice: uniq.includes(activeEndpoint.customerVoice) ? activeEndpoint.customerVoice : uniq[0],
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingVoices(false);
    }
  }

  async function handleSave() {
    if (!activeEndpoint) {
      setSaveDialog({
        tone: 'error',
        title: '缺少配置',
        text: '请先选择一个 TTS 配置，再执行保存。',
      });
      return;
    }

    if (!activeEndpoint.salesVoice.trim()) {
      setSaveDialog({
        tone: 'error',
        title: '缺少销售角色音色',
        text: '请先填写或选择销售角色音色 ID。',
      });
      return;
    }

    if (!activeEndpoint.customerVoice.trim()) {
      setSaveDialog({
        tone: 'error',
        title: '缺少客户角色音色',
        text: '请先填写或选择客户角色音色 ID。',
      });
      return;
    }

    if (activeEndpoint.salesVoice === activeEndpoint.customerVoice) {
      setSaveDialog({
        tone: 'error',
        title: '角色音色不能相同',
        text: '销售角色和客户角色必须使用不同的音色，请重新选择。',
      });
      return;
    }

    if (!isEdgePreset && !activeEndpoint.baseUrl.trim()) {
      setSaveDialog({
        tone: 'error',
        title: '缺少 Base URL',
        text: '当前 TTS 服务需要 Base URL，请先填写后再保存。',
      });
      return;
    }

    await onSaveConfig();
  }

  function setDefaultTtsId(id: string) {
    setConfig(prev => ({ ...prev, activeTtsId: id }));
    setSaveDialog(null);
  }

  function updateEndpoint(id: string, partial: Partial<TtsEndpointConfig>) {
    setConfig((prev) => ({
      ...prev,
      ttsEndpoints: prev.ttsEndpoints.map(e => e.id === id ? { ...e, ...partial } : e),
    }));
    setSaveDialog(null);
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
      salesVoice: 'zh-CN-XiaoxiaoNeural',
      customerVoice: 'zh-CN-YunjianNeural',
    };
    setConfig((prev) => ({
      ...prev,
      ttsEndpoints: [...prev.ttsEndpoints, newEp],
    }));
    setSelectedEndpointId(newId);
    setSaveDialog(null);
  }

  function deleteEndpoint(id: string) {
    setConfig((prev) => {
      const next = prev.ttsEndpoints.filter((e) => e.id !== id);
      return {
        ...prev,
        ttsEndpoints: next,
        activeTtsId: prev.activeTtsId === id ? (next.length > 0 ? next[0].id : '') : prev.activeTtsId,
      };
    });

    setSelectedEndpointId(current => {
      if (current !== id) {
        return current;
      }
      const next = config.ttsEndpoints.filter((e) => e.id !== id);
      if (config.activeTtsId && config.activeTtsId !== id && next.some(endpoint => endpoint.id === config.activeTtsId)) {
        return config.activeTtsId;
      }
      return next[0]?.id ?? '';
    });
    setSaveDialog(null);
  }

  const currentPreset =
    activeEndpoint &&
    (TTS_PRESETS.find(p => p.provider === activeEndpoint.provider) || TTS_PRESETS[0]);

  const isTitleLocked =
    !!activeEndpoint &&
    TTS_PRESETS.some(p => p.provider === activeEndpoint.provider);

  const allowBaseUrlEdit = !!activeEndpoint && !isEdgePreset;

  return (
    <div className="layout-split animate-slide-up">
      <aside className="sub-sidebar">
        <div className="sub-sidebar__header">TTS 端点列表库</div>
        <button className="add-button" onClick={addEndpoint} type="button">
          <span className="icon-shape icon-shape--plus" aria-hidden="true" />
          <span>新增发音节点</span>
        </button>
        <div className="sub-sidebar__list">
          {config.ttsEndpoints.map((ep) => (
            <div
              key={ep.id}
              className={`sub-nav-item ${selectedEndpointId === ep.id ? 'is-active' : ''}`}
              onClick={() => setSelectedEndpointId(ep.id)}
            >
              <div className="sub-nav-item__content">
                <span>{ep.title}</span>
                {defaultEndpointId === ep.id ? <span className="sub-nav-item__badge">默认</span> : null}
              </div>
              <button className="del-btn" type="button" onClick={(e) => { e.stopPropagation(); deleteEndpoint(ep.id); }}>
                <span className="icon-shape icon-shape--close" aria-hidden="true" />
              </button>
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
              <div className="config-default-banner">
                <div className="config-default-banner__title">默认 TTS 配置</div>
                <div className="config-default-banner__text">
                  生成页不会单独选择 TTS，音频合成始终使用这里设置的默认配置。
                </div>
                <button
                  className={`chip-button ${defaultEndpointId === activeEndpoint.id ? 'is-active' : 'strong-secondary'}`}
                  onClick={() => setDefaultTtsId(activeEndpoint.id)}
                  disabled={defaultEndpointId === activeEndpoint.id}
                  type="button"
                >
                  {defaultEndpointId === activeEndpoint.id ? '当前默认 TTS' : '设为默认 TTS'}
                </button>
                {savedDefaultEndpointId !== defaultEndpointId ? (
                  <div className="field-helper-text">默认 TTS 已变更，记得点击下方“保存配置”生效。</div>
                ) : null}
              </div>

              <div className="config-section-header">
                <div className="field-block config-section-header__field-block">
                  <label>预设服务商</label>
                  <ConfigSelect
                    value={currentPreset?.label || 'Edge TTS (免费)'}
                    options={TTS_PRESETS.map(p => ({
                      value: p.label,
                      label: p.label,
                    }))}
                    onChange={(label) => {
                      const preset = TTS_PRESETS.find(p => p.label === label);
                      if (!preset) {
                        return;
                      }

                      updateEndpoint(activeEndpoint.id, {
                        title: preset.label,
                        provider: preset.provider,
                        baseUrl: preset.baseUrl,
                        ttsModel: preset.ttsModel,
                        salesVoice: preset.salesVoice,
                        customerVoice: preset.customerVoice,
                      });
                    }}
                    placeholder="请选择服务商"
                    disabled={supplierLocked}
                  />
                  {supplierLocked ? (
                    <div className="field-helper-text">当前端点已保存，供应商不可更改；如需切换，请新增配置。</div>
                  ) : null}
                </div>
              </div>

              <div className="config-form-stack">
                <div className="group-card">
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
                </div>

                {!isEdgePreset ? (
                  <div className="group-card config-form-stack__group-card">
                    <div className="field-block">
                      <label>API Key</label>
                      <input
                        className="field-control"
                        type="password"
                        value={activeEndpoint.apiKey}
                        onChange={e => updateEndpoint(activeEndpoint.id, { apiKey: e.target.value })}
                        placeholder="sk-..."
                      />
                    </div>

                    <div className="field-block config-field-offset">
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
                ) : null}

                <div className="group-card config-form-stack__group-card">
                  <div className="field-inline-header">
                    <div className="group-card__title group-card__title--tight">角色配音设定</div>
                    {isQwenPreset ? (
                      <button
                        className="chip-button strong-secondary compact-chip-button"
                        type="button"
                        onClick={fetchVoices}
                        disabled={loadingVoices}
                      >
                        {loadingVoices ? '获取中…' : '获取音色'}
                      </button>
                    ) : null}
                  </div>
                  <div className="config-grid-2">
                    <div className="field-block">
                      <label>销售角色音色 ID</label>
                      {isEdgePreset ? (
                        <ConfigSelect
                          value={activeEndpoint.salesVoice}
                          options={edgeVoiceOptions}
                          onChange={(salesVoice) => updateEndpoint(activeEndpoint.id, { salesVoice })}
                          placeholder="请选择音色"
                        />
                      ) : isQwenPreset && qwenVoiceOptions.length > 0 ? (
                        <ConfigSelect
                          value={activeEndpoint.salesVoice}
                          options={qwenVoiceOptions}
                          onChange={(salesVoice) => updateEndpoint(activeEndpoint.id, { salesVoice })}
                          placeholder="请选择音色"
                        />
                      ) : (
                        <input
                          className="field-control"
                          value={activeEndpoint.salesVoice}
                          onChange={e => updateEndpoint(activeEndpoint.id, { salesVoice: e.target.value })}
                        />
                      )}
                    </div>
                    <div className="field-block">
                      <label>客户角色音色 ID</label>
                      {isEdgePreset ? (
                        <ConfigSelect
                          value={activeEndpoint.customerVoice}
                          options={edgeVoiceOptions}
                          onChange={(customerVoice) => updateEndpoint(activeEndpoint.id, { customerVoice })}
                          placeholder="请选择音色"
                        />
                      ) : isQwenPreset && qwenVoiceOptions.length > 0 ? (
                        <ConfigSelect
                          value={activeEndpoint.customerVoice}
                          options={qwenVoiceOptions}
                          onChange={(customerVoice) => updateEndpoint(activeEndpoint.id, { customerVoice })}
                          placeholder="请选择音色"
                        />
                      ) : (
                        <input
                          className="field-control"
                          value={activeEndpoint.customerVoice}
                          onChange={e => updateEndpoint(activeEndpoint.id, { customerVoice: e.target.value })}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="config-save-row">
                  <button className="btn-save" onClick={handleSave} disabled={configSaveState === 'saving'} type="button">
                    {configSaveState === 'saving' ? '保存中...' : configSaveState === 'error' ? '保存失败，请重试' : configSaveState === 'success' && !hasUnsavedChanges ? '已保存' : '保存配置'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {saveDialog ? (
        <div className="dialog-overlay" onClick={() => setSaveDialog(null)}>
          <div className="dialog-card" onClick={e => e.stopPropagation()}>
            <div className={`dialog-badge dialog-badge--${saveDialog.tone}`}>
              {saveDialog.tone === 'info' ? '提示' : '错误'}
            </div>
            <div className="dialog-title">{saveDialog.title}</div>
            <div className="dialog-text">{saveDialog.text}</div>
            <div className="dialog-actions">
              <button className="chip-button is-active" onClick={() => setSaveDialog(null)} type="button">
                我知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
