import { ScoreItem } from '../types';

interface Props {
    item: ScoreItem;
    index: number;
}

export default function ScoreCard({ item, index }: Props) {
    const pct = (item.score / item.maxScore) * 100;
    const color = pct >= 80 ? 'var(--success)'
        : pct >= 60 ? 'var(--warning)'
            : 'var(--danger)';

    return (
        <div style={{
            padding: '12px 14px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            animation: `fade-in 0.3s ${index * 0.06}s both`,
        }}>
            {/* 顶行：名称 + 分数 */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
            }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {item.label}
          </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color }}>
              {item.score}
            </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              /{item.maxScore}
            </span>
                </div>
            </div>

            {/* 进度条 */}
            <div style={{
                height: 4,
                background: 'var(--border)',
                borderRadius: 2,
                overflow: 'hidden',
                marginBottom: 8,
            }}>
                <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: color,
                    borderRadius: 2,
                    transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
                    boxShadow: `0 0 6px ${color}80`,
                }} />
            </div>

            {/* 评语 */}
            <p style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                lineHeight: 1.5,
                margin: 0,
            }}>
                {item.comment}
            </p>

            <style>{`
          @keyframes fade-in {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        </div>
    );
}