import React from 'react';
import ConfigSelect from '../components/config/ConfigSelect';
import TranscriptPanel from '../components/TranscriptPanel';
import { logger } from '../utils/logger';
import { AppConfig, GenerateBusyState, GenerateConversationInput, RecordingState, TranscriptSegment } from '../types';

interface GeneratePageProps {
  config: AppConfig;
  transcript: TranscriptSegment[];
  streamingText: string;
  onGenerate: (params: GenerateConversationInput) => Promise<void>;
  onGenerateAudio: () => Promise<void>;
  busy: GenerateBusyState;
}

const DEFAULT_FORM: GenerateConversationInput = {
  scenario: '金融保险行业，续保提醒场景，客户比较犹豫，担心价格上涨，希望销售用专业亲和的方式推进到下一次沟通。',
  rounds: 6,
  supplementalPrompt: '',
};

const MIN_ROUNDS = 2;

function normalizeRoundsInput(value: string): string {
  return value.replace(/[^\d]/g, '');
}

function parseRounds(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const rounds = Number(value);
  if (!Number.isInteger(rounds)) {
    return null;
  }

  return rounds;
}

function isValidRounds(value: string): boolean {
  const rounds = parseRounds(value);
  return rounds !== null && rounds >= MIN_ROUNDS;
}

export { MIN_ROUNDS };

export default function GeneratePage({
  config,
  transcript,
  streamingText,
  onGenerate,
  onGenerateAudio,
  busy,
}: GeneratePageProps) {
  const [form, setForm] = React.useState<GenerateConversationInput>(DEFAULT_FORM);
  const [roundsInput, setRoundsInput] = React.useState(String(DEFAULT_FORM.rounds));

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
  const defaultTts = config.ttsEndpoints.find(endpoint => endpoint.id === config.activeTtsId) ?? config.ttsEndpoints[0];
  const hasScenario = form.scenario.trim().length > 0;
  const hasValidRounds = isValidRounds(roundsInput);
  const canGenerate = Boolean(selectedLlm?.apiKey && selectedLlm?.baseUrl && selectedLlm?.model && hasScenario && hasValidRounds);
  const hasValidDefaultTts = Boolean(defaultTts?.salesVoice?.trim() && defaultTts?.customerVoice?.trim() && (defaultTts.provider === 'edge' || defaultTts.baseUrl?.trim()));

  React.useEffect(() => {
    const rounds = parseRounds(roundsInput) ?? DEFAULT_FORM.rounds;
    setForm(prev => ({ ...prev, rounds }));
  }, [roundsInput]);

  const isGeneratingConversation = busy.generatingConversation;
  const isGeneratingAudio = busy.generatingAudio;
  const recordingState: RecordingState = isGeneratingConversation ? 'processing' : transcript.length > 0 ? 'done' : 'idle';

  function updateForm<Key extends keyof GenerateConversationInput>(key: Key, value: GenerateConversationInput[Key]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleGenerate() {
    if (!selectedLlmId || !canGenerate) {
      return;
    }

    const rounds = parseRounds(roundsInput);
    if (rounds === null || rounds < MIN_ROUNDS) {
      return;
    }

    onGenerate({
      ...form,
      scenario: form.scenario.trim(),
      rounds,
      supplementalPrompt: form.supplementalPrompt?.trim() ?? '',
      llmEndpointId: selectedLlmId,
    }).catch(err => {
      logger.error('generate-page', '触发生成请求失败', err);
    });
  }

  return (
    <div className="page-stage generate-page-stage">
      <div className="layout-split generate-workspace generate-workspace--wide-right">
        <div className="form-content generate-side-column">
          <section className="config-page-card generate-form-card storage-card">
            <div className="config-form-wrapper generate-form-scroll">
              <div className="storage-card__header generate-form-card__header">
                <div className="storage-card__content">
                  <div className="storage-card__title">智能生成对话</div>
                  <div className="storage-card__desc">先描述完整场景，再补充卖点、顾虑和推进目标，系统会直接生成多轮销售对话。</div>
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
                    <label>{`对话轮数（≥${MIN_ROUNDS}）`}</label>
                    <input
                      className="field-control"
                      type="number"
                      min={MIN_ROUNDS}
                      step={1}
                      value={roundsInput}
                      onChange={e => setRoundsInput(normalizeRoundsInput(e.target.value))}
                      placeholder="请输入对话轮数"
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
              </div>
            </div>

            <div className="generate-form-actions">
              <div className="generate-form-actions__row">
                <button
                  className="primary-button generate-form-submit"
                  onClick={handleGenerate}
                  disabled={isGeneratingConversation || !canGenerate || !selectedLlmId}
                  type="button"
                >
                  {isGeneratingConversation ? '脑力激荡中...' : '开始生成对话'}
                </button>

                {transcript.length > 0 && !streamingText.trim() ? (
                  <button className="success-button generate-form-submit" onClick={onGenerateAudio} disabled={isGeneratingConversation || isGeneratingAudio} type="button">
                    {isGeneratingAudio ? '正在合成音频...' : '同步合成本地音频'}
                  </button>
                ) : null}
              </div>

              {transcript.length > 0 && !streamingText.trim() ? (
                <div className="generate-audio-note">
                  {hasValidDefaultTts && defaultTts
                    ? `默认 TTS：${defaultTts.title || defaultTts.ttsModel || '未命名 TTS'}，如需切换请前往 TTS 配置页。`
                    : '默认 TTS 不可用，请先到 TTS 配置页补全并保存默认配置。'}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <div className="card-base conversation-layout generate-transcript-card">
          <TranscriptPanel transcript={transcript} recordingState={recordingState} streamingText={streamingText} />
        </div>
      </div>
    </div>
  );
}
