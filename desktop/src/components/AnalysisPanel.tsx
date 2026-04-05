import { useState, type ReactNode } from 'react';
import { AnalysisResult, RecordingState } from '../types';
import ScoreCard from './ScoreCard';

interface Props {
    analysis: AnalysisResult | null;
    recordingState: RecordingState;
}

type Tab = 'score' | 'suggest' | 'summary';

const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'score', label: '评分详情' },
    { key: 'suggest', label: '改进建议' },
    { key: 'summary', label: '通话摘要' },
];

export default function AnalysisPanel({ analysis, recordingState }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('score');
    const isProcessing = recordingState === 'processing';

    return (
        <div className="analysis-panel">
            <div className="analysis-panel__header">
                <div className="analysis-panel__title">AI 分析报告</div>

                {analysis && <TotalScoreRing score={analysis.totalScore} />}

                {isProcessing && (
                    <div className="analysis-panel__status">
                        <SpinnerIcon size={28} />
                    </div>
                )}

                {!analysis && !isProcessing && (
                    <div className="analysis-panel__empty-header">录音完成后显示分析</div>
                )}
            </div>

            <div className="analysis-panel__tabs">
                {TABS.map((tab) => {
                    const isActive = activeTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            disabled={!analysis}
                            className={`analysis-panel__tab ${isActive ? 'is-active' : ''}`}
                            type="button"
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            <div className="analysis-panel__content">
                {!analysis && !isProcessing && <EmptyAnalysis />}
                {isProcessing && <AnalysisSkeletons />}
                {analysis && activeTab === 'score' && (
                    <div className="analysis-panel__score-list">
                        {analysis.scores.map((item, index) => (
                            <ScoreCard key={item.label} item={item} index={index} />
                        ))}
                    </div>
                )}
                {analysis && activeTab === 'suggest' && (
                    <SuggestionList suggestions={analysis.suggestions} highlights={analysis.highlights} />
                )}
                {analysis && activeTab === 'summary' && <SummaryView summary={analysis.summary} />}
            </div>
        </div>
    );
}

function TotalScoreRing({ score }: { score: number }) {
    const boundedScore = Math.max(0, Math.min(score, 100));
    const angle = (boundedScore / 100) * 360;

    return (
        <div className="analysis-score-ring-wrap">
            <div
                className="analysis-score-ring"
                style={{ background: `conic-gradient(var(--success) 0deg ${angle}deg, var(--bg-card) ${angle}deg 360deg)` }}
            >
                <div className="analysis-score-ring__inner">
                    <div className="analysis-score-ring__value">{boundedScore}</div>
                    <div className="analysis-score-ring__label">总分</div>
                </div>
            </div>
        </div>
    );
}

function SpinnerIcon({ size = 18 }: { size?: number }) {
    return <div className="analysis-spinner" style={{ width: size, height: size }} />;
}

function EmptyAnalysis() {
    return (
        <div className="analysis-empty-state">
            <div className="analysis-empty-state__title">暂无分析结果</div>
            <div className="analysis-empty-state__text">开始录音或上传音频后，右侧将展示评分、建议和摘要。</div>
        </div>
    );
}

function AnalysisSkeletons() {
    return (
        <div className="analysis-skeleton-list">
            {Array.from({ length: 4 }).map((_, index) => (
                <div
                    key={index}
                    className="analysis-skeleton-item"
                    style={{ opacity: 0.6 + index * 0.08 }}
                />
            ))}
        </div>
    );
}

function SuggestionList({ suggestions, highlights }: { suggestions: string[]; highlights: string[] }) {
    return (
        <div className="analysis-stack">
            <SectionBlock title="改进建议">
                <ul className="analysis-list">
                    {suggestions.map((item) => (
                        <li key={item} className="analysis-list__item">
                            {item}
                        </li>
                    ))}
                </ul>
            </SectionBlock>

            <SectionBlock title="沟通亮点">
                <ul className="analysis-list">
                    {highlights.map((item) => (
                        <li key={item} className="analysis-list__item">
                            {item}
                        </li>
                    ))}
                </ul>
            </SectionBlock>
        </div>
    );
}

function SummaryView({ summary }: { summary: string }) {
    return (
        <SectionBlock title="通话摘要">
            <p className="analysis-summary">{summary}</p>
        </SectionBlock>
    );
}

function SectionBlock({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="analysis-section">
            <div className="analysis-section__title">{title}</div>
            {children}
        </div>
    );
}
