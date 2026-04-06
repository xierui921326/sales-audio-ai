import React from 'react';
import ConfigPlaceholder from '../components/config/ConfigPlaceholder';
import ConfigSelect from '../components/config/ConfigSelect';
import { AppConfig, TtsEndpointConfig } from '../types';

const TTS_PRESETS = [
  { label: 'Edge TTS (免费)', provider: 'edge', ttsModel: 'edge-local', baseUrl: '', salesVoice: 'zh-CN-YunxiNeural', customerVoice: 'zh-CN-XiaoxiaoNeural' },
  { label: 'OpenAI TTS', provider: 'openai', ttsModel: 'tts-1', baseUrl: 'https://api.openai.com/v1', salesVoice: 'alloy', customerVoice: 'nova' },
  { label: '火山引擎 (ByteDance)', provider: 'volc', ttsModel: '', baseUrl: '', salesVoice: 'zh_female_shuangma_base_24k', customerVoice: 'zh_male_yaoguang_base_24k' },
  { label: '自定义 (Custom)', provider: 'custom', ttsModel: '', baseUrl: '', salesVoice: '', customerVoice: '' },
] as const;

interface TtsConfigPageProps {
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  onSaveConfig: () => Promise<void>;
  configSaveState: 'idle' | 'saving' | 'success' | 'error';
}

export default function TtsConfigPage({ config, setConfig, onSaveConfig, configSaveState }: TtsConfigPageProps) {
  const activeEndpoint = config.ttsEndpoints.find((e) => e.id === config.activeTtsId);

  function setActiveTtsId(id: string) {
    setConfig((prev) => ({ ...prev, activeTtsId: id }));
  }

  function updateEndpoint(id: string, partial: Partial<TtsEndpointConfig>) {
    setConfig((prev) => ({
      ...prev,
      ttsEndpoints: prev.ttsEndpoints.map(e => e.id === id ? { ...e, ...partial } : e),
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
    setConfig((prev) => ({
      ...prev,
      ttsEndpoints: [...prev.ttsEndpoints, newEp],
      activeTtsId: newId,
    }));
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
  }

  const currentPreset =
    activeEndpoint &&
    (TTS_PRESETS.find(
      p =>
        p.provider === activeEndpoint.provider &&
        p.baseUrl === activeEndpoint.baseUrl &&
        p.ttsModel === activeEndpoint.ttsModel
    ) || TTS_PRESETS.find(p => p.label === '自定义 (Custom)'));

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
        <button className="add-button" onClick={addEndpoint} type="button">
          <span className="icon-shape icon-shape--plus" aria-hidden="true" />
          <span>新增发音节点</span>
        </button>
        <div className="sub-sidebar__list">
          {config.ttsEndpoints.map((ep) => (
            <div
              key={ep.id}
              className={`sub-nav-item ${config.activeTtsId === ep.id ? 'is-active' : ''}`}
              onClick={() => setActiveTtsId(ep.id)}
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
          <ConfigPlaceholder message="请选择或新增TTS配置" />
        ) : (
          <div className="config-page-card animate-fade-in">
            <div className="config-form-wrapper">
              <div className="config-section-header">
                <div className="field-block config-section-header__field-block">
                  <label>预设服务商</label>
                  <ConfigSelect
                    value={currentPreset?.label || '自定义 (Custom)'}
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
                        title: preset.label === '自定义 (Custom)' ? '新语音服务' : preset.label,
                        provider: preset.provider,
                        baseUrl: preset.baseUrl,
                        ttsModel: preset.ttsModel,
                        salesVoice: preset.salesVoice,
                        customerVoice: preset.customerVoice,
                      });
                    }}
                    placeholder="自定义 (Custom)"
                  />
                </div>
              </div>

              <div className="config-form-stack">
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
                      <input className="field-control" placeholder="例如：测试环境" />
                    </div>
                  </div>
                </div>

                <div className="group-card config-form-stack__group-card">
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

                <div className="group-card config-form-stack__group-card">
                  <div className="field-inline-header">
                    <div className="group-card__title group-card__title--tight">角色配音设定</div>
                    <button
                      className="chip-button strong-secondary compact-chip-button"
                      type="button"
                      onClick={() => {}}
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
    </div>
  );
}
