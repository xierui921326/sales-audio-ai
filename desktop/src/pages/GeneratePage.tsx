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

const DEFAULT_FORM: GenerateConversationInput = {
  industry: '',
  scenario: '金融保险行业，续保提醒场景，客户比较犹豫，担心价格上涨，希望销售用专业亲和的方式推进到下一次沟通。',
  customerRole: '',
  tone: '',
  rounds: 6,
  supplementalPrompt: '',
};

export default function GeneratePage({
  config,
  transcript,
  onGenerate,
  onGenerateAudio,
  busy,
}: GeneratePageProps) {
  const [form, setForm] = React.useState<GenerateConversationInput>(DEFAULT_FORM);

  const llmOptions = React.useMemo(
    () => config.llmEndpoints.map(endpoint => ({
      value: endpoint.id,
      label: endpoint.title || endpoint.model || '未命名 LLM',
    })),
    [config.llmEndpoints]
  );

  const roundOptions = React.useMemo(
    () => Array.from({ length: 11 }, (_, index) => {
      const rounds = index + 2;
      return { value: String(rounds), label: `${rounds} 轮` };
    }),
    []
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
  const hasScenario = form.scenario.trim().length > 0;
  const canGenerate = Boolean(selectedLlm?.apiKey && selectedLlm?.baseUrl && selectedLlm?.model && hasScenario);
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
      industry: '',
      customerRole: '',
      tone: '',
      scenario: form.scenario.trim(),
      supplementalPrompt: form.supplementalPrompt?.trim() ?? '',
      llmEndpointId: selectedLlmId,
    }).catch(console.error);
  }

  return (
    <div className="page-stage">
      <header className="page-stage__header">
        <div className="section-heading compact">
          <h2>智能生成对话</h2>
          <p>直接描述完整场景，系统会结合补充要求生成多轮销售对话。</p>
        </div>
      </header>

      <div className="layout-split generate-workspace generate-workspace--wide-right">
        <div className="form-content generate-side-column">
          <section className="config-page-card generate-form-card storage-card">
            <div className="config-form-wrapper generate-form-scroll">
              <div className="storage-card__header generate-form-card__header">
                <div className="storage-card__content">
                  <div className="storage-card__title">生成参数</div>
                  <div className="storage-card__desc">先描述完整场景，再补充卖点、顾虑和推进目标。</div>
                </div>
              </div>

              <div className="generate-form-stack">
                <div className="field-block">
                  <label>对话场景</label>
                  <textarea
                    className="field-control generate-form-textarea"
                    value={form.scenario}
                    onChange={e => updateForm('scenario', e.target.value)}
                    placeholder="例如：金融保险行业，续保提醒场景，客户比较犹豫，担心价格上涨，希望销售用专业亲和的方式推进到下一次沟通。"
                  />
                </div>

                <div className="field-block">
                  <label>补充要求</label>
                  <textarea
                    className="field-control generate-form-textarea generate-form-textarea--compact"
                    value={form.supplementalPrompt ?? ''}
                    onChange={e => updateForm('supplementalPrompt', e.target.value)}
                    placeholder="例如：突出服务升级，不要过度施压，不要承诺无法兑现的优惠。"
                  />
                </div>

                <div className="generate-advanced-panel">
                  <div className="field-block">
                    <label>对话轮数</label>
                    <ConfigSelect
                      value={String(form.rounds)}
                      options={roundOptions}
                      onChange={value => updateForm('rounds', Number(value) || 2)}
                      placeholder="请选择对话轮数"
                    />
                  </div>

                  <div className="field-block">
                    <label>本次生成使用的 LLM</label>
                    <ConfigSelect
                      value={selectedLlmId}
                      options={llmOptions}
                      onChange={setSelectedLlmId}
                      placeholder="请选择 LLM 配置"
                    />
                  </div>
                </div>

                {!hasScenario ? (
                  <div className="generate-form-hint">请先填写对话场景，再开始生成。</div>
                ) : !llmOptions.length ? (
                  <div className="generate-form-hint">请先到 LLM 配置页新增可用端点。</div>
                ) : !selectedLlm?.apiKey || !selectedLlm?.baseUrl || !selectedLlm?.model ? (
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
            </div>
          </section>
        </div>

        <div className="card-base conversation-layout generate-transcript-card">
          <TranscriptPanel transcript={transcript} recordingState={recordingState} />
        </div>
      </div>
    </div>
  );
}
