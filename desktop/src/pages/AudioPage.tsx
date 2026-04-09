import { AudioFileItem } from '../types';

interface AudioPageProps {
  audioFiles: AudioFileItem[];
  playingId: string | null;
  onPlay: (id: string) => void;
  busy: boolean;
}

export default function AudioPage({ audioFiles, playingId, onPlay, busy }: AudioPageProps) {
  return (
    <div className="audio-list-container audio-list-container--spaced animate-slide-up">
      {audioFiles.length > 0 ? (
        <div className="audio-list-grid">
          {audioFiles.map((file) => (
            <div key={file.id} className={`audio-row-item glass-panel ${playingId === file.id ? 'is-playing' : ''}`}>
              <div className="audio-row-item__inner">
                <button className="play-toggle" onClick={() => onPlay(file.id)} disabled={busy}>
                  <span className={`play-toggle__icon ${playingId === file.id ? 'is-pause' : 'is-play'}`} aria-hidden="true" />
                </button>
                <div className="audio-row-item__content">
                  <div className="audio-row-item__title">{file.title}</div>
                  <div className="audio-row-item__meta-row">
                    <span className="audio-row-item__meta-label">文件名</span>
                    <span className="audio-row-item__meta audio-row-item__file-name">{file.fileName}</span>
                  </div>
                </div>
                <div className="audio-row-item__duration">{file.duration}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state--padded">
          <p className="empty-state__text">目前暂无已生成的音频，请先前往“生成对话”页进行合成</p>
        </div>
      )}
    </div>
  );
}
