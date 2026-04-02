import { RecordingState } from '../types';

interface Props {
    recordingState: RecordingState;
}

const statusMap: Record<RecordingState, { label: string; color: string }> = {
    idle: { label: '待机', color: '#64748b' },
    recording: { label: '录音中', color: '#ef4444' },
    processing: { label: 'AI 分析中', color: '#f59e0b' },
    done: { label: '分析完成', color: '#22c55e' },
};

export default function Header({ recordingState }: Props) {
    const status = statusMap[recordingState];

    return (
        <header style={{
            height: 52,
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            gap: 12,
            flexShrink: 0,
        }}>
            {/* 拖拽区域 (Tauri) */}
            <div data-tauri-drag-region style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                height: 52,
            }} />

            {/* Logo */}
            <div style={{
                width: 28, height: 28,
                background: 'linear-gradient(135deg, var(--accent), #a78bfa)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                flexShrink: 0,
                zIndex: 1,
            }}>
                🎙
            </div>

            <span style={{
                fontWeight: 700,
                fontSize: 15,
                color: 'var(--text-primary)',
                zIndex: 1,
            }}>
          Sales Audio AI
        </span>

            {/* 状态指示 */}
            <div style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                zIndex: 1,
            }}>
          <span style={{
              width: 7, height: 7,
              borderRadius: '50%',
              background: status.color,
              boxShadow: recordingState === 'recording'
                  ? `0 0 8px ${status.color}` : 'none',
              animation: recordingState === 'recording'
                  ? 'pulse 1.2s infinite' : 'none',
          }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {status.label}
          </span>
            </div>

            <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
        </header>
    );
}