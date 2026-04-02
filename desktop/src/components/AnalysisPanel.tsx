import { useState, type CSSProperties } from 'react';
import { AnalysisResult, RecordingState } from '../types';
import ScoreCard from './ScoreCard';

interface Props {
    analysis: AnalysisResult | null;
    recordingState: RecordingState;
}

type Tab = 'score' | 'suggest' | 'summary';

export default function AnalysisPanel({ analysis, recordingState }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('score');
    const isProcessing = recordingState === 'processing';

    return (
        <div style={panelStyle}>
            <div style={headerStyle}>
                <div style={titleStyle}>AI 分析报告</div>

                {analysis && <TotalScoreRing score={analysis.totalScore} />}

                {isProcessing && (
                    <div style={statusContainerStyle}>
                        <SpinnerIcon size={28} />
                    </div>
                )}

                {!analysis && !isProcessing && (
                    <div style={emptyHeaderStyle}>录音完成后显示分析</div>
                )}
            </div>

            <div style={tabBarStyle}>
                {([
                    { key: 'score', label: '评分详情' },
                    { key: 'suggest', label: '改进建议' },
                    { key: 'summary', label: '通话摘要' },
                ] as Array<{ key: Tab; label: string }>).map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        disabled={!analysis}
                        style={{
                            ...tabButtonStyle,
                            borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                            color: activeTab === tab.key ? 'var(--accent-light)' : 'var(--text-muted)',
                            cursor: analysis ? 'pointer' : 'not-allowed',
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div style={contentStyle}>
                {!analysis && !isProcessing && <EmptyAnalysis />}
                {isProcessing && <AnalysisSkeletons />}
                {analysis && activeTab === 'score' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
        <div style={scoreRingWrapperStyle}>
            <div
                style={{
                    ...scoreRingStyle,
                    background: `conic-gradient(var(--success) 0deg ${angle}deg, var(--bg-card) ${angle}deg 360deg)`,
                }}
            >
                <div style={scoreRingInnerStyle}>
                    <div style={scoreValueStyle}>{boundedScore}</div>
                    <div style={scoreLabelStyle}>总分</div>
                </div>
            </div>
        </div>
    );
}

function SpinnerIcon({ size = 18 }: { size?: number }) {
    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: '50%',
                border: '2px solid var(--border)',
                borderTopColor: 'var(--text-secondary)',
                animation: 'spin 0.9s linear infinite',
                flexShrink: 0,
            }}
        >
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}

function EmptyAnalysis() {
    return (
        <div style={placeholderStyle}>
            <div style={placeholderTitleStyle}>暂无分析结果</div>
            <div style={placeholderTextStyle}>开始录音或上传音频后，右侧将展示评分、建议和摘要。</div>
        </div>
    );
}

function AnalysisSkeletons() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Array.from({ length: 4 }).map((_, index) => (
                <div
                    key={index}
                    style={{
                        height: 72,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        opacity: 0.6 + index * 0.08,
                    }}
                />
            ))}
        </div>
    );
}

function SuggestionList({ suggestions, highlights }: { suggestions: string[]; highlights: string[] }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionBlock title="改进建议">
                <ul style={listStyle}>
                    {suggestions.map((item) => (
                        <li key={item} style={listItemStyle}>
                            {item}
                        </li>
                    ))}
                </ul>
            </SectionBlock>

            <SectionBlock title="沟通亮点">
                <ul style={listStyle}>
                    {highlights.map((item) => (
                        <li key={item} style={listItemStyle}>
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
            <p style={summaryTextStyle}>{summary}</p>
        </SectionBlock>
    );
}

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={sectionStyle}>
            <div style={sectionTitleStyle}>{title}</div>
            {children}
        </div>
    );
}

const panelStyle: CSSProperties = {
    background: 'var(--bg-secondary)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
};

const headerStyle: CSSProperties = {
    padding: '12px 20px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
};

const titleStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 10,
};

const statusContainerStyle: CSSProperties = {
    height: 80,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const emptyHeaderStyle: CSSProperties = {
    height: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    color: 'var(--text-muted)',
};

const tabBarStyle: CSSProperties = {
    display: 'flex',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
};

const tabButtonStyle: CSSProperties = {
    flex: 1,
    padding: '10px 0',
    background: 'transparent',
    border: 'none',
    fontSize: 12,
    fontWeight: 600,
    transition: 'all 0.2s',
};

const contentStyle: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '14px 16px',
};

const scoreRingWrapperStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    padding: '4px 0 8px',
};

const scoreRingStyle: CSSProperties = {
    width: 88,
    height: 88,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const scoreRingInnerStyle: CSSProperties = {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
};

const scoreValueStyle: CSSProperties = {
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--text-primary)',
    lineHeight: 1,
};

const scoreLabelStyle: CSSProperties = {
    marginTop: 4,
    fontSize: 11,
    color: 'var(--text-muted)',
};

const placeholderStyle: CSSProperties = {
    minHeight: 180,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    textAlign: 'center',
};

const placeholderTitleStyle: CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-secondary)',
};

const placeholderTextStyle: CSSProperties = {
    fontSize: 12,
    lineHeight: 1.6,
    color: 'var(--text-muted)',
    maxWidth: 240,
};

const sectionStyle: CSSProperties = {
    padding: '12px 14px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
};

const sectionTitleStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: 10,
};

const listStyle: CSSProperties = {
    margin: 0,
    paddingLeft: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
};

const listItemStyle: CSSProperties = {
    color: 'var(--text-secondary)',
    fontSize: 12,
    lineHeight: 1.6,
};

const summaryTextStyle: CSSProperties = {
    margin: 0,
    color: 'var(--text-secondary)',
    fontSize: 12,
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
};
