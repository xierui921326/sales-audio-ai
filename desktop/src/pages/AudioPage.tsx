import { useEffect, useMemo, useState } from 'react';
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

interface AudioRowProps {
  file: AudioFileItem;
  selected: boolean;
  active: boolean;
  editing: boolean;
  saving: boolean;
  draftName: string;
  notePlaceholder: string;
  onSelect: () => void;
  onDraftNameChange: (value: string) => void;
  onStartEditName: () => void;
  onCancelEditName: () => void;
  onSaveName: () => Promise<void>;
}

function formatTime(seconds: number): string {
  const normalized = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(normalized / 60)
    .toString()
    .padStart(2, '0');
  const remainingSeconds = (normalized % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function getDisplayName(file: AudioFileItem): string {
  return file.displayName?.trim() || '';
}

function getNoteText(file: AudioFileItem): string {
  return getDisplayName(file) || file.title;
}

function AudioRow({
  file,
  selected,
  active,
  editing,
  saving,
  draftName,
  notePlaceholder,
  onSelect,
  onDraftNameChange,
  onStartEditName,
  onCancelEditName,
  onSaveName,
}: AudioRowProps) {
  const displayTitle = file.fileName || file.title;
  const noteText = getNoteText(file);
  const canEditName = file.role === 'merged';

  return (
    <div
      className={`audio-row-item ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="audio-row-item__name">
        <div className="audio-row-item__title">{displayTitle}</div>
      </div>

      <div className="audio-row-item__note-line">
        {canEditName ? (
          editing ? (
            <input
              className="field-control audio-row-item__note-input"
              type="text"
              value={draftName}
              placeholder={notePlaceholder}
              maxLength={60}
              disabled={saving}
              autoFocus
              onClick={event => event.stopPropagation()}
              onChange={event => onDraftNameChange(event.target.value)}
              onBlur={() => void onSaveName()}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void onSaveName();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancelEditName();
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="audio-row-item__note-trigger"
              onClick={event => {
                event.stopPropagation();
                onStartEditName();
              }}
            >
              {noteText}
            </button>
          )
        ) : (
          <span className="audio-row-item__note">{noteText}</span>
        )}
      </div>

      <div className="audio-row-item__duration">{file.duration}</div>
    </div>
  );
}

export default function AudioPage({
  audioFiles,
  playingId,
  isPlaying,
  currentTime,
  currentDuration,
  loadingAudioId,
  onPlay,
  onSeek,
  onSkip,
  onSaveDisplayName,
  busy,
}: AudioPageProps) {
  const activeFile = useMemo(() => audioFiles.find(file => file.id === playingId) ?? null, [audioFiles, playingId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [savingNameId, setSavingNameId] = useState<string | null>(null);

  useEffect(() => {
    if (audioFiles.length === 0) {
      setSelectedId(null);
      return;
    }

    if (selectedId && audioFiles.some(file => file.id === selectedId)) {
      return;
    }

    setSelectedId(playingId ?? audioFiles[0].id);
  }, [audioFiles, playingId, selectedId]);

  useEffect(() => {
    if (playingId) {
      setSelectedId(playingId);
    }
  }, [playingId]);

  const selectedFile = useMemo(() => {
    if (selectedId) {
      return audioFiles.find(file => file.id === selectedId) ?? null;
    }
    return activeFile ?? audioFiles[0] ?? null;
  }, [activeFile, audioFiles, selectedId]);

  useEffect(() => {
    if (!editingNameId) {
      return;
    }

    const editingFile = audioFiles.find(file => file.id === editingNameId);
    if (!editingFile) {
      setEditingNameId(null);
      setDraftName('');
      return;
    }

    setDraftName(getDisplayName(editingFile));
  }, [audioFiles, editingNameId]);

  const selectedIsActive = Boolean(selectedFile && selectedFile.id === playingId);
  const playbackDuration = selectedFile
    ? selectedIsActive
      ? currentDuration > 0
        ? currentDuration
        : selectedFile.durationSeconds ?? 0
      : selectedFile.durationSeconds ?? 0
    : 0;
  const progressMax = playbackDuration > 0 ? playbackDuration : 0;
  const progressValue = selectedIsActive ? Math.min(currentTime, progressMax || currentTime) : 0;
  const canControlPlayback = Boolean(selectedFile?.filePath) && !busy;
  const canSeekPlayback = selectedIsActive && progressMax > 0 && loadingAudioId !== selectedFile?.id;

  function handleSelect(fileId: string) {
    setSelectedId(fileId);
  }

  function handleStartEditName(file: AudioFileItem) {
    setSelectedId(file.id);
    setDraftName(getDisplayName(file));
    setEditingNameId(file.id);
  }

  function handleCancelEditName(file: AudioFileItem) {
    setDraftName(getDisplayName(file));
    if (editingNameId === file.id) {
      setEditingNameId(null);
    }
  }

  async function handleSaveName(file: AudioFileItem) {
    if (file.role !== 'merged') {
      return;
    }

    const trimmed = draftName.trim();
    const currentDisplayName = getDisplayName(file);
    if (!trimmed || trimmed === currentDisplayName) {
      setDraftName(currentDisplayName);
      setEditingNameId(null);
      return;
    }

    setSavingNameId(file.id);
    try {
      await onSaveDisplayName(file.id, trimmed);
      setEditingNameId(null);
    } finally {
      setSavingNameId(current => (current === file.id ? null : current));
    }
  }

  return (
    <div className="audio-page animate-slide-up">
      <div className="audio-list-container audio-list-container--spaced">
        {audioFiles.length > 0 ? (
          <div className="audio-list-grid">
            {audioFiles.map(file => {
              const selected = selectedFile?.id === file.id;
              const active = playingId === file.id;
              const editing = editingNameId === file.id;
              const saving = savingNameId === file.id;

              return (
                <AudioRow
                  key={file.id}
                  file={file}
                  selected={selected}
                  active={active}
                  editing={editing}
                  saving={saving}
                  draftName={editing ? draftName : ''}
                  notePlaceholder={file.title || '备注名'}
                  onSelect={() => handleSelect(file.id)}
                  onDraftNameChange={setDraftName}
                  onStartEditName={() => handleStartEditName(file)}
                  onCancelEditName={() => handleCancelEditName(file)}
                  onSaveName={() => handleSaveName(file)}
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

      {selectedFile ? (
        <div className="audio-player-dock glass-panel">
          <div className="audio-player-dock__top">
            <div className="audio-player-dock__info">
              <div className="audio-player-dock__title">{selectedFile.fileName || selectedFile.title}</div>
              <div className="audio-player-dock__note">{getNoteText(selectedFile)}</div>
            </div>

            <div className="audio-player-dock__controls">
              <button
                className="audio-row-item__skip-button"
                type="button"
                onClick={() => onSkip(selectedFile.id, -5)}
                disabled={!canSeekPlayback}
              >
                -5 秒
              </button>
              <button
                className="play-toggle play-toggle--large"
                type="button"
                onClick={() => void onPlay(selectedFile.id)}
                disabled={!canControlPlayback || loadingAudioId === selectedFile.id}
              >
                <span
                  className={`play-toggle__icon ${selectedIsActive && isPlaying ? 'is-pause' : 'is-play'}`}
                  aria-hidden="true"
                />
              </button>
              <button
                className="audio-row-item__skip-button"
                type="button"
                onClick={() => onSkip(selectedFile.id, 5)}
                disabled={!canSeekPlayback}
              >
                +5 秒
              </button>
            </div>

            <div className="audio-player-dock__time">
              {formatTime(progressValue)} / {formatTime(playbackDuration)}
            </div>
          </div>

          <input
            className="audio-player-dock__progress"
            type="range"
            min={0}
            max={progressMax || 0}
            step={1}
            value={progressValue}
            disabled={!canSeekPlayback}
            onChange={event => onSeek(selectedFile.id, Number(event.target.value))}
          />
        </div>
      ) : null}
    </div>
  );
}
