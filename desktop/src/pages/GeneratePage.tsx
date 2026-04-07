import React from 'react';
import ConfigSelect from '../components/config/ConfigSelect';
import TranscriptPanel from '../components/TranscriptPanel';
import { AppConfig, GenerateConversationInput, RecordingState, TranscriptSegment } from '../types';

interface GeneratePageProps {
  config: AppConfig;
  transcript: TranscriptSegment[];
  onGenerate: (params: GenerateConversationInput) => Promise<void>;
  onGenerateAudio: () => Promise<void>;
  busy: boolean;
}

export default function GeneratePage({
  config,
  transcript,
  onGenerate,
  onGenerateAudio,
  busy,
}: GeneratePageProps) {
  const [form, setForm] = React.useState<GenerateConversationInput>({
    industry: '金融保险',
    scenario: '新抢单续保提醒',
    customerRole: '犹豫不决的客户',
    tone: '专业且亲和',
    rounds: 6,
  });

  const llmOptions = React.useMemo(
    () => config.llmEndpoints.map(endpoint => ({
      value: endpoint.id,
      label: endpoint.title || endpoint.model || '未命名 LLM',
    })),
    [config.llmEndpoints]
  );

  const defaultLlmId = React.useMemo(() => {
    if (config.activeLlmId && config.llmEndpoints.some(endpoint => endpoint.id === config.activeLlmId)) {
      return config.activeLlmId;
    }

    return config.llmEndpoints[0]?.id ?? '';
  }, [config.activeLlmId, config.llmEndpoints]);

  const [selectedLlmId, setSelectedLlmId] = React.useState(defaultLlmId);

  React.useEffect(() => {
    setSelectedLlmId(current => {
      if (current && config.llmEndpoints.some(endpoint => endpoint.id === current)) {
        return current;
      }
      return defaultLlmId;
    });
  }, [config.llmEndpoints, defaultLlmId]);

  const selectedLlm = config.llmEndpoints.find(endpoint => endpoint.id === selectedLlmId);
  const canGenerate = Boolean(selectedLlm?.apiKey && selectedLlm?.baseUrl && selectedLlm?.model);
  const recordingState: RecordingState = busy ? 'processing' : transcript.length > 0 ? 'done' : 'idle';

  function updateForm<Key extends keyof GenerateConversationInput>(key: Key, value: GenerateConversationInput[Key]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleGenerate() {
    if (!selectedLlmId || !canGenerate) {
      return;
    }

    onGenerate({
      ...form,
      llmEndpointId: selectedLlmId,
    }).catch(console.error);
  }

  return (
    <div className="page-stage">
      <header className="page-stage__header">
        <div className="section-heading compact">
          <h2>智能生成对话</h2>
          <p>选择本次使用的 LLM，并按场景参数生成销售对话。</p>
        </div>
      </header>

      <div className="page-stage__grid page-stage__grid--split">
        <div className="card-base conversation-layout overflow-hidden">
          <TranscriptPanel transcript={transcript} recordingState={recordingState} />
        </div>

        <div className="generate-side-column">
          <section className="card-base generate-form-card">
            <div className="section-heading compact generate-form-card__header">
              <h3>场景参数配置</h3>
            </div>
            <div className="generate-form-stack">
              <div className="field-block">
                <label>本次生成使用的 LLM</label>
                <ConfigSelect
                  value={selectedLlmId}
                  options={llmOptions}
                  onChange={setSelectedLlmId}
                  placeholder="请选择 LLM 配置"
                />
              </div>

              <div className="field-block">
                <label>所属行业</label>
                <input className="field-control" value={form.industry} onChange={e => updateForm('industry', e.target.value)} />
              </div>

              <div className="field-block">
                <label>对话场景</label>
                <textarea className="field-control generate-form-textarea" value={form.scenario} onChange={e => updateForm('scenario', e.target.value)} />
              </div>

              <div className="field-block">
                <label>客户角色</label>
                <input className="field-control" value={form.customerRole} onChange={e => updateForm('customerRole', e.target.value)} />
              </div>

              <div className="field-block">
                <label>对话语气</label>
                <input className="field-control" value={form.tone} onChange={e => updateForm('tone', e.target.value)} />
              </div>

              <div className="field-block">
                <label>轮数</label>
                <input
                  className="field-control"
                  type="number"
                  min={2}
                  max={12}
                  value={form.rounds}
                  onChange={e => updateForm('rounds', Math.max(2, Math.min(12, Number(e.target.value) || 2)))}
                />
              </div>

              {!llmOptions.length ? (
                <div className="generate-form-hint">请先到 LLM 配置页新增可用端点。</div>
              ) : !canGenerate ? (
                <div className="generate-form-hint">当前所选 LLM 缺少 API Key、Base URL 或模型，请先补全配置。</div>
              ) : null}

              <button
                className="primary-button generate-form-submit"
                onClick={handleGenerate}
                disabled={busy || !canGenerate || !selectedLlmId}
                type="button"
              >
                {busy ? '脑力激荡中...' : '开始生成对话'}
              </button>

              {transcript.length > 0 ? (
                <button className="success-button generate-form-submit" onClick={onGenerateAudio} disabled={busy} type="button">
                  同步合成本地音频
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
