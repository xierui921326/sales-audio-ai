import React from 'react';
import { AnalysisResult, TranscriptSegment, RecordingState, GenerateConversationInput } from '../types';
import TranscriptPanel from '../components/TranscriptPanel';
import AnalysisPanel from '../components/AnalysisPanel';

interface GeneratePageProps {
  transcript: TranscriptSegment[];
  analysis: AnalysisResult | null;
  onGenerate: (params: GenerateConversationInput) => Promise<void>;
  onGenerateAudio: () => Promise<void>;
  busy: boolean;
  canGenerate: boolean;
}

export default function GeneratePage({
  transcript,
  analysis,
  onGenerate,
  onGenerateAudio,
  busy,
  canGenerate,
}: GeneratePageProps) {
  const [form, setForm] = React.useState<GenerateConversationInput>({
    industry: '金融保险',
    scenario: '新抢单续保提醒',
    customerRole: '犹豫不决的客户',
    tone: '专业且亲和',
    rounds: 6,
  });

  const recordingState: RecordingState = busy ? 'processing' : transcript.length > 0 ? 'done' : 'idle';

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

        <div className="generate-side-column">
          <section className="card-base generate-form-card">
            <div className="section-heading compact generate-form-card__header">
              <h3>场景参数配置</h3>
            </div>
            <div className="generate-form-stack">
              <div className="field-block">
                <label>所属行业</label>
                <input className="field-control" value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} />
              </div>
              <div className="field-block">
                <label>对话场景</label>
                <textarea className="field-control generate-form-textarea" value={form.scenario} onChange={e => setForm({ ...form, scenario: e.target.value })} />
              </div>
              <button
                className="primary-button generate-form-submit"
                onClick={() => onGenerate(form)}
                disabled={busy || !canGenerate}
                type="button"
              >
                {busy ? '脑力激荡中...' : '开始生成对话'}
              </button>
            </div>
          </section>

          <div className="card-base generate-analysis-card">
            <AnalysisPanel analysis={analysis} recordingState={recordingState} />
            {transcript.length > 0 && (
              <div className="generate-analysis-card__footer">
                <button className="success-button generate-analysis-card__action" onClick={onGenerateAudio} disabled={busy} type="button">
                  同步合成本地音频
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
