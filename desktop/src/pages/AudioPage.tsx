import { useEffect, useState } from 'react';
import { AudioFileItem } from '../types';

interface AudioPageProps {
  audioFiles: AudioFileItem[];
  playingId: string | null;
  isPlaying: boolean;
  currentTime: number;
  currentDuration: number;
  loadingAudioId: string | null;
  onPlay: (id: string) => Promise<void>;
  onSeek: (id: string, nextTime: number) => void;
  onSkip: (id: string, deltaSeconds: number) => void;
  onSaveDisplayName: (id: string, displayName: string) => Promise<void>;
  busy: boolean;
}

function formatTime(seconds: number): string {
  const normalized = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(normalized / 60).toString().padStart(2, '0');
  const remainingSeconds = (normalized % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function getDisplayName(file: AudioFileItem): string {
  return file.displayName?.trim() || '';
}

interface AudioRowProps {
  file: AudioFileItem;
  active: boolean;
  isPlaying: boolean;
  currentTime: number;
  currentDuration: number;
  loading: boolean;
  busy: boolean;
  onPlay: (id: string) => Promise<void>;
  onSeek: (id: string, nextTime: number) => void;
  onSkip: (id: string, deltaSeconds: number) => void;
  onSaveDisplayName: (id: string, displayName: string) => Promise<void>;
}

function AudioRow({ file, active, isPlaying, currentTime, currentDuration, loading, busy, onPlay, onSeek, onSkip, onSaveDisplayName }: AudioRowProps) {
  const [draftName, setDraftName] = useState(getDisplayName(file));
  const [savingName, setSavingName] = useState(false);
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    setDraftName(getDisplayName(file));
    setEditingName(false);
  }, [file.displayName, file.fileName, file.title]);

  const playbackDuration = active && currentDuration > 0 ? currentDuration : file.durationSeconds ?? 0;
  const canEditName = file.role === 'merged';
  const canPlay = Boolean(file.filePath) && !busy;
  const progressMax = playbackDuration > 0 ? playbackDuration : 0;
  const progressValue = active ? Math.min(currentTime, progressMax || currentTime) : 0;
  const displayNamePlaceholder = file.title || '备注名';
  const displayTitle = file.fileName || file.title;

  async function handleSaveName() {
    const trimmed = draftName.trim();
    const currentDisplayName = file.displayName?.trim() || '';
    if (!canEditName) {
      return;
    }
    if (!trimmed) {
      setDraftName(currentDisplayName);
      setEditingName(false);
      return;
    }
    if (trimmed === currentDisplayName) {
      setDraftName(currentDisplayName);
      setEditingName(false);
      return;
    }

    setSavingName(true);
    try {
      await onSaveDisplayName(file.id, trimmed);
      setEditingName(false);
    } finally {
      setSavingName(false);
    }
  }

  return (
    <div className={`audio-row-item glass-panel ${active ? 'is-playing' : ''}`}>
      <div className="audio-row-item__inner">
        <button className="play-toggle" onClick={() => void onPlay(file.id)} disabled={!canPlay || loading}>
          <span className={`play-toggle__icon ${active && isPlaying ? 'is-pause' : 'is-play'}`} aria-hidden="true" />
        </button>

        <div className="audio-row-item__content">
          <div className="audio-row-item__header">
            <div className="audio-row-item__title-group">
              <div className="audio-row-item__title">{displayTitle}</div>
              {canEditName ? (
                <div className="audio-row-item__note-inline">
                  {active || editingName ? (
                    <input
                      className="field-control audio-row-item__display-name-input"
                      type="text"
                      value={draftName}
                      placeholder={displayNamePlaceholder}
                      maxLength={60}
                      disabled={savingName}
                      autoFocus={editingName}
                      onChange={event => setDraftName(event.target.value)}
                      onBlur={() => void handleSaveName()}
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleSaveName();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setDraftName(getDisplayName(file));
                          setEditingName(false);
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="audio-row-item__note-trigger"
                      onClick={() => setEditingName(true)}
                    >
                      {getDisplayName(file) || displayNamePlaceholder}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            <div className="audio-row-item__duration">{active ? `${formatTime(currentTime)} / ${formatTime(playbackDuration)}` : file.duration}</div>
          </div>

          {active ? (
            <div className="audio-row-item__playback">
              <div className="audio-row-item__progress-row">
                <button className="audio-row-item__skip-button" type="button" onClick={() => onSkip(file.id, -5)} disabled={loading}>
                  -5秒
                </button>
                <input
                  className="audio-row-item__progress"
                  type="range"
                  min={0}
                  max={progressMax || 0}
                  step={1}
                  value={progressValue}
                  disabled={progressMax <= 0 || loading}
                  onChange={event => onSeek(file.id, Number(event.target.value))}
                />
                <button className="audio-row-item__skip-button" type="button" onClick={() => onSkip(file.id, 5)} disabled={loading}>
                  +5秒
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function AudioPage({ audioFiles, playingId, isPlaying, currentTime, currentDuration, loadingAudioId, onPlay, onSeek, onSkip, onSaveDisplayName, busy }: AudioPageProps) {
  return (
    <div className="audio-list-container audio-list-container--spaced animate-slide-up">
      {audioFiles.length > 0 ? (
        <div className="audio-list-grid">
          {audioFiles.map(file => {
            const active = playingId === file.id;
            return (
              <AudioRow
                key={file.id}
                file={file}
                active={active}
                isPlaying={active && isPlaying}
                currentTime={active ? currentTime : 0}
                currentDuration={active ? currentDuration : 0}
                loading={loadingAudioId === file.id}
                busy={busy}
                onPlay={onPlay}
                onSeek={onSeek}
                onSkip={onSkip}
                onSaveDisplayName={onSaveDisplayName}
              />
            );
          })}
        </div>
      ) : (
        <div className="empty-state empty-state--padded">
          <p className="empty-state__text">目前暂无已生成的音频，请先前往“生成对话”页进行合成</p>
        </div>
      )}
    </div>
  );
}
