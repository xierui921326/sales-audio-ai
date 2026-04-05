import { ScoreItem } from '../types';

interface Props {
    item: ScoreItem;
    index: number;
}

export default function ScoreCard({ item, index }: Props) {
    const pct = (item.score / item.maxScore) * 100;
    const toneClass = pct >= 80 ? 'is-good' : pct >= 60 ? 'is-warn' : 'is-danger';

    return (
        <div className="score-card" style={{ animationDelay: `${index * 0.06}s` }}>
            <div className="score-card__header">
                <span className="score-card__label">{item.label}</span>
                <div className="score-card__value-group">
                    <span className={`score-card__value ${toneClass}`}>{item.score}</span>
                    <span className="score-card__max">/{item.maxScore}</span>
                </div>
            </div>

            <div className="score-card__progress">
                <div className={`score-card__progress-bar ${toneClass}`} style={{ width: `${pct}%` }} />
            </div>

            <p className="score-card__comment">{item.comment}</p>
        </div>
    );
}
