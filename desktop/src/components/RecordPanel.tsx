import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RecordingState, TranscriptSegment, AnalysisResult } from '../types';

interface Props {
    recordingState: RecordingState;
    setRecordingState: (s: RecordingState) => void;
    setTranscript: (t: TranscriptSegment[]) => void;
    setAnalysis: (a: AnalysisResult | null) => void;
}

export default function RecordPanel({
    recordingState,
    setRecordingState,
    setTranscript,
    setAnalysis,
}: Props) {
    const [duration, setDuration] = useState(0);
    const [waveData, setWaveData] = useState<number[]>(Array(40).fill(4));
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const processRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (animRef.current) clearInterval(animRef.current);
            if (processRef.current) clearTimeout(processRef.current);
        };
    }, []);

    const formatTime = (seconds: number) => {
        const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
        const remainSeconds = (seconds % 60).toString().padStart(2, '0');
        return `${minutes}:${remainSeconds}`;
    };

    const fillMockResult = (delay: number) => {
        if (processRef.current) clearTimeout(processRef.current);

        processRef.current = setTimeout(() => {
            setTranscript(MOCK_TRANSCRIPT);
            setAnalysis(MOCK_ANALYSIS);
            setRecordingState('done');
        }, delay);
    };

    const startRecording = () => {
        setRecordingState('recording');
        setDuration(0);
        setAnalysis(null);
        setTranscript([]);

        if (timerRef.current) clearInterval(timerRef.current);
        if (animRef.current) clearInterval(animRef.current);

        timerRef.current = setInterval(() => setDuration((value) => value + 1), 1000);
        animRef.current = setInterval(() => {
            setWaveData(Array.from({ length: 40 }, () => 4 + Math.random() * 28));
        }, 80);
    };

    const stopRecording = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (animRef.current) clearInterval(animRef.current);

        setWaveData(Array(40).fill(4));
        setRecordingState('processing');
        fillMockResult(2500);
    };

    const reset = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (animRef.current) clearInterval(animRef.current);
        if (processRef.current) clearTimeout(processRef.current);

        setRecordingState('idle');
        setDuration(0);
        setTranscript([]);
        setAnalysis(null);
        setWaveData(Array(40).fill(4));
    };

    const handleUpload = () => {
        setRecordingState('processing');
        setDuration(0);
        setTranscript([]);
        setAnalysis(null);
        fillMockResult(2000);
    };

    const isRecording = recordingState === 'recording';
    const isProcessing = recordingState === 'processing';

    return (
        <div style={panelStyle}>
            <div style={waveContainerStyle}>
                {waveData.map((height, index) => (
                    <div
                        key={index}
                        style={{
                            width: 3,
                            height,
                            borderRadius: 2,
                            background: isRecording ? 'var(--success)' : 'var(--border)',
                            transition: isRecording ? 'height 0.08s ease' : 'all 0.3s ease',
                        }}
                    />
                ))}
            </div>

            <div style={actionRowStyle}>
                {!isRecording && !isProcessing && recordingState !== 'done' && (
                    <button onClick={startRecording} style={btnStyle('#ef4444')}>
                        <span style={{ fontSize: 16 }}>开始</span>
                        录音
                    </button>
                )}

                {isRecording && (
                    <button onClick={stopRecording} style={btnStyle('var(--accent)')}>
                        <span style={{ fontSize: 16 }}>停止</span>
                        录音
                    </button>
                )}

                {isProcessing && (
                    <button disabled style={{ ...btnStyle('#64748b'), cursor: 'not-allowed' }}>
                        <SpinnerIcon />
                        AI 分析中...
                    </button>
                )}

                {recordingState === 'done' && (
                    <button onClick={reset} style={btnStyle('var(--success)')}>
                        <span style={{ fontSize: 16 }}>重新</span>
                        录音
                    </button>
                )}

                {(isRecording || isProcessing || recordingState === 'done') && (
                    <span style={{
                        fontFamily: 'monospace',
                        fontSize: 18,
                        fontWeight: 700,
                        color: isRecording ? '#ef4444' : 'var(--text-secondary)',
                        letterSpacing: 2,
                        minWidth: 52,
                    }}>
                        {formatTime(duration)}
                    </span>
                )}

                {recordingState === 'idle' && (
                    <label style={{
                        ...btnStyle('transparent'),
                        border: '1px dashed var(--border)',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: 13,
                    }}>
                        上传音频
                        <input type="file" accept="audio/*" hidden onChange={handleUpload} />
                    </label>
                )}
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
                border: '2px solid rgba(255, 255, 255, 0.25)',
                borderTopColor: '#fff',
                animation: 'record-panel-spin 0.9s linear infinite',
                flexShrink: 0,
            }}
        >
            <style>{`@keyframes record-panel-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}

const btnStyle = (bg: string): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 18px',
    background: bg,
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
});

const panelStyle: CSSProperties = {
    padding: '20px 24px',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
};

const waveContainerStyle: CSSProperties = {
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    marginBottom: 16,
};

const actionRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
};

const MOCK_TRANSCRIPT: TranscriptSegment[] = [
    {
        id: '1',
        speaker: 'sales',
        text: '您好，我先了解一下您目前的客户跟进方式和团队规模。',
        startTime: 0,
        endTime: 6,
        keywords: ['客户跟进', '团队规模'],
    },
    {
        id: '2',
        speaker: 'customer',
        text: '我们现在主要靠手工记录，销售有 8 个人，复盘效率比较低。',
        startTime: 7,
        endTime: 14,
        keywords: ['手工记录', '复盘效率'],
    },
    {
        id: '3',
        speaker: 'sales',
        text: '明白了，这种场景很适合用 AI 自动转录和话术分析来提效。',
        startTime: 15,
        endTime: 22,
        keywords: ['AI 自动转录', '话术分析'],
    },
];

const MOCK_ANALYSIS: AnalysisResult = {
    totalScore: 84,
    scores: [
        { label: '开场破冰', score: 17, maxScore: 20, comment: '开场自然，建立了基础信任。' },
        { label: '需求挖掘', score: 26, maxScore: 30, comment: '能够主动追问现有流程和痛点。' },
        { label: '价值呈现', score: 24, maxScore: 30, comment: '方案与客户场景关联较强。' },
        { label: '收尾推进', score: 17, maxScore: 20, comment: '可进一步加强下一步行动确认。' },
    ],
    suggestions: [
        '在需求确认后补充量化问题，例如每周复盘时长和转化率。',
        '价值介绍后增加一个成功案例，增强说服力。',
        '结束前明确下次演示或方案确认时间。',
    ],
    highlights: [
        '较快识别客户当前依赖手工记录的低效问题。',
        '成功将 AI 转录能力和团队管理场景建立关联。',
    ],
    summary: '本次通话聚焦客户当前销售管理流程，明确了人工记录和复盘效率低的问题。销售侧能够较好地承接痛点，并将 AI 转录与分析能力映射到客户场景，具备继续推进演示和方案沟通的基础。',
};
