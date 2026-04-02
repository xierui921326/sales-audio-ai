import { useEffect, useRef } from 'react';
import { TranscriptSegment, RecordingState } from '../types';

interface Props {
    transcript: TranscriptSegment[];
    recordingState: RecordingState;
}

export default function TranscriptPanel({ transcript, recordingState }: Props) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript]);

    const isEmpty = transcript.length === 0;
    const isProcessing = recordingState === 'processing';

    return (
        <div style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-primary)',
        }}>
            {/* 标题栏 */}
            <div style={{
                padding: '12px 24px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
            }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
            转录文本
          </span>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                    <LegendDot color="var(--sales-color)" label="销售" />
                    <LegendDot color="var(--customer-color)" label="客户" />
                </div>
            </div>

            {/* 内容区 */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px 24px',
            }}>
                {isProcessing && isEmpty ? (
                    <ProcessingPlaceholder />
                ) : isEmpty ? (
                    <EmptyPlaceholder recordingState={recordingState} />
                ) : (
                    <>
                        {transcript.map((seg) => (
                            <SegmentBubble key={seg.id} segment={seg} />
                        ))}
                        {/* 实时录音时显示正在输入指示器 */}
                        {recordingState === 'recording' && (
                            <TypingIndicator />
                        )}
                    </>
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

// ── 子组件 ────────────────────────────────────────

function SegmentBubble({ segment }: { segment: TranscriptSegment }) {
    const isSales = segment.speaker === 'sales';
    const color = isSales ? 'var(--sales-color)' : 'var(--customer-color)';
    const label = isSales ? '销售' : '客户';

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60).toString().padStart(2, '0');
        const sec = (s % 60).toString().padStart(2, '0');
        return `${m}:${sec}`;
    };

    // 高亮关键词
    const renderText = (text: string, keywords?: string[]) => {
        if (!keywords || keywords.length === 0) return text;
        const pattern = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
        const parts = text.split(pattern);
        return parts.map((part, i) =>
            pattern.test(part) ? (
                <mark key={i} style={{
                    background: 'rgba(108, 99, 255, 0.25)',
                    color: 'var(--accent-light)',
                    borderRadius: 3,
                    padding: '0 2px',
                }}>
                    {part}
                </mark>
            ) : part
        );
    };

    return (
        <div style={{
            marginBottom: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: isSales ? 'flex-start' : 'flex-end',
        }}>
            {/* 说话人 + 时间 */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 4,
                flexDirection: isSales ? 'row' : 'row-reverse',
            }}>
                <div style={{
                    width: 20, height: 20,
                    borderRadius: '50%',
                    background: color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    flexShrink: 0,
                }}>
                    {label[0]}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {label} · {formatTime(segment.startTime)}
          </span>
            </div>

            {/* 气泡 */}
            <div style={{
                maxWidth: '80%',
                padding: '10px 14px',
                background: isSales ? 'var(--bg-card)' : 'rgba(108,99,255,0.12)',
                border: `1px solid ${isSales ? 'var(--border)' : 'rgba(108,99,255,0.3)'}`,
                borderRadius: isSales
                    ? '4px 12px 12px 12px'
                    : '12px 4px 12px 12px',
                fontSize: 14,
                lineHeight: 1.6,
                color: 'var(--text-primary)',
            }}>
                {renderText(segment.text, segment.keywords)}
            </div>
        </div>
    );
}

function TypingIndicator() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
            <div style={{
                width: 20, height: 20, borderRadius: '50%',
                background: 'var(--sales-color)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: '#fff', fontWeight: 700,
            }}>销</div>
            <div style={{
                padding: '8px 14px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '4px 12px 12px 12px',
                display: 'flex', gap: 4, alignItems: 'center',
            }}>
                {[0, 1, 2].map(i => (
                    <span key={i} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: 'var(--text-muted)',
                        display: 'inline-block',
                        animation: `typing-dot 1.2s ${i * 0.2}s infinite`,
                    }} />
                ))}
            </div>
            <style>{`
          @keyframes typing-dot {
            0%, 80%, 100% { transform: scale(0.8); opacity: 0.4; }
            40% { transform: scale(1.1); opacity: 1; }
          }
        `}</style>
        </div>
    );
}

function EmptyPlaceholder({ recordingState }: { recordingState: RecordingState }) {
    return (
        <div style={{
            height: '100%', minHeight: 200,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 10, color: 'var(--text-muted)',
        }}>
            <span style={{ fontSize: 36, opacity: 0.3 }}>🎙</span>
            <span style={{ fontSize: 13 }}>
          {recordingState === 'idle' ? '开始录音或上传音频后显示转录文本' : '暂无转录内容'}
        </span>
        </div>
    );
}

function ProcessingPlaceholder() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[80, 60, 90, 50, 70].map((w, i) => (
                <div key={i} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: i % 2 === 0 ? 'flex-start' : 'flex-end',
                    gap: 6,
                }}>
                    <div style={{
                        width: 60, height: 10,
                        background: 'var(--bg-card)',
                        borderRadius: 4,
                        animation: 'skeleton-pulse 1.5s infinite',
                    }} />
                    <div style={{
                        width: `${w}%`, height: 40,
                        background: 'var(--bg-card)',
                        borderRadius: 8,
                        animation: `skeleton-pulse 1.5s ${i * 0.1}s infinite`,
                    }} />
                </div>
            ))}
            <style>{`
          @keyframes skeleton-pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.8; }
          }
        `}</style>
        </div>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
                width: 8, height: 8, borderRadius: '50%', background: color,
            }} />
            <span>{label}</span>
        </div>
    );
}