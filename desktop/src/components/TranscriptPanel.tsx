import { useEffect, useRef } from 'react';
import { TranscriptSegment, RecordingState } from '../types';

interface Props {
    transcript: TranscriptSegment[];
    recordingState: RecordingState;
}

export default function TranscriptPanel({ transcript, recordingState }: Props) {
    const bottomRef = useRef<HTMLDivElement>(null);

    // 新对话进来后自动滚到底部，避免用户每次生成后还要手动下拉查看最新内容。
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript]);

    const isEmpty = transcript.length === 0;
    const isProcessing = recordingState === 'processing';

    return (
        <div className="transcript-panel">
            <div className="transcript-panel__header">
                <span className="transcript-panel__title">转录文本</span>
                <div className="transcript-panel__legend">
                    <LegendDot color="var(--sales-color)" label="销售" />
                    <LegendDot color="var(--customer-color)" label="客户" />
                </div>
            </div>

            <div className={`transcript-panel__content${isProcessing && isEmpty ? ' transcript-panel__content--processing' : ''}`}>
                {isProcessing && isEmpty ? (
                    <ProcessingOverlay />
                ) : isEmpty ? (
                    <EmptyPlaceholder recordingState={recordingState} />
                ) : (
                    <>
                        {transcript.map(seg => (
                            <SegmentBubble key={seg.id} segment={seg} />
                        ))}
                        {recordingState === 'recording' && <TypingIndicator />}
                    </>
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

function SegmentBubble({ segment }: { segment: TranscriptSegment }) {
    const isSales = segment.speaker === 'sales';
    const label = isSales ? '销售' : '客户';
    const speakerColor = isSales ? 'var(--sales-color)' : 'var(--customer-color)';
    const partialClassName = segment.isPartial ? ' is-partial' : '';
    const isStreaming = segment.isStreaming ?? false;

    const formatTime = (s: number): string => {
        const m = Math.floor(s / 60).toString().padStart(2, '0');
        const sec = (s % 60).toString().padStart(2, '0');
        return `${m}:${sec}`;
    };

    // 关键词高亮是可选增强，不影响正文展示；没有关键词时直接返回原文。
    const renderText = (text: string, keywords?: string[]) => {
        if (!keywords || keywords.length === 0) return text;
        const pattern = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
        const parts = text.split(pattern);
        return parts.map((part, i) =>
            pattern.test(part) ? (
                <mark key={i} className="transcript-bubble__mark">
                    {part}
                </mark>
            ) : part
        );
    };

    return (
        <div className={`transcript-segment ${isSales ? 'is-sales' : 'is-customer'}${partialClassName}`}>
            <div className={`transcript-segment__meta-row${segment.isPartial ? ' transcript-segment__meta-row--partial' : ''}`}>
                <div className={`transcript-segment__avatar${segment.isPartial ? ' transcript-segment__avatar--partial' : ''}`} style={{ background: speakerColor }}>
                    {label[0]}
                </div>
                <span className={`transcript-segment__meta-text${segment.isPartial ? ' transcript-segment__meta-text--partial' : ''}`}>
                    {label} · {formatTime(segment.startTime)}
                </span>
                {segment.isPartial && isStreaming ? <span className="transcript-segment__status">输入中</span> : null}
            </div>

            <div className={`transcript-bubble${segment.isPartial ? ' transcript-bubble--partial' : ''}${isStreaming ? ' is-streaming' : ''}`} aria-live={isStreaming ? 'polite' : undefined}>
                {renderText(segment.text, segment.keywords)}
            </div>
        </div>
    );
}

function TypingIndicator() {
    return (
        <div className="transcript-typing">
            <div className="transcript-segment__avatar" style={{ background: 'var(--sales-color)' }}>
                销
            </div>
            <div className="transcript-typing__bubble">
                {[0, 1, 2].map(i => (
                    <span key={i} className="transcript-typing__dot" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
            </div>
        </div>
    );
}

function EmptyPlaceholder({ recordingState }: { recordingState: RecordingState }) {
    return (
        <div className="transcript-empty-state">
            <span className="placeholder-icon" aria-hidden="true">
                <span className="placeholder-icon__mic" />
            </span>
            <span className="transcript-empty-state__text">
                {recordingState === 'idle' ? '开始录音或上传音频后显示转录文本' : '暂无转录内容'}
            </span>
        </div>
    );
}

function ProcessingOverlay() {
    return (
        <div className="transcript-processing-overlay">
            <div className="transcript-skeleton-list" aria-hidden="true">
                {[
                    { width: 74, side: 'sales' },
                    { width: 56, side: 'customer' },
                    { width: 68, side: 'sales' },
                ].map((item, i) => (
                    <div key={i} className={`transcript-skeleton-item ${item.side === 'sales' ? 'is-sales' : 'is-customer'}`}>
                        <div className="transcript-skeleton-item__meta" />
                        <div className="transcript-skeleton-item__bubble" style={{ width: `${item.width}%` }} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <div className="transcript-legend-item">
            <div className="transcript-legend-item__dot" style={{ background: color }} />
            <span>{label}</span>
        </div>
    );
}
