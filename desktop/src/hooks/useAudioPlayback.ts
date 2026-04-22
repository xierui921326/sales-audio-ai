import { useEffect, useRef, useState } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import { AudioFileItem } from '../types';
import { logger } from '../utils/logger';

type GenerateDialogTone = 'error' | 'info' | 'success';

interface GenerateDialogInput {
  title: string;
  text: string;
  tone: GenerateDialogTone;
}

interface UseAudioPlaybackOptions {
  audioFiles: AudioFileItem[];
  onPlaybackError: (dialog: GenerateDialogInput) => void;
}

interface UseAudioPlaybackResult {
  playingId: string | null;
  isPlaying: boolean;
  currentTime: number;
  currentDuration: number;
  loadingAudioId: string | null;
  resetAudioPlayback: () => void;
  handleSeek: (id: string, nextTime: number) => void;
  handleSkip: (id: string, deltaSeconds: number) => void;
  handlePlay: (id: string) => Promise<void>;
}

function formatAudioMimeType(target: string): string {
  const ext = target.split('.').pop()?.toLowerCase();
  return ext === 'mp3' ? 'audio/mpeg' : 'audio/wav';
}

async function loadAudioSource(target: string): Promise<string> {
  const audioBytes = await readFile(target);
  const audioBlob = new Blob([audioBytes], { type: formatAudioMimeType(target) });
  return URL.createObjectURL(audioBlob);
}

export function useAudioPlayback({ audioFiles, onPlaybackError }: UseAudioPlaybackOptions): UseAudioPlaybackResult {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const revokeAudioObjectUrl = () => {
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
    };

    const resetPlaybackState = () => {
      setPlayingId(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentDuration(0);
      setLoadingAudioId(null);
    };

    const handleLoadedMetadata = () => {
      setCurrentDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setCurrentTime(audio.currentTime);
      setLoadingAudioId(null);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handlePause = () => {
      if (!audio.ended) {
        setIsPlaying(false);
      }
    };

    const handlePlayEvent = () => {
      setIsPlaying(true);
      setLoadingAudioId(null);
    };

    const handleEnded = () => {
      resetPlaybackState();
      audio.removeAttribute('src');
      audio.load();
      revokeAudioObjectUrl();
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlayEvent);
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlayEvent);
      audio.removeEventListener('ended', handleEnded);
      revokeAudioObjectUrl();
      audioRef.current = null;
    };
  }, []);

  function resetAudioPlayback() {
    const player = audioRef.current;
    if (!player) {
      setPlayingId(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentDuration(0);
      setLoadingAudioId(null);
      return;
    }

    player.pause();
    player.currentTime = 0;
    player.removeAttribute('src');
    player.load();
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
    setPlayingId(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentDuration(0);
    setLoadingAudioId(null);
  }

  function handleSeek(id: string, nextTime: number) {
    const player = audioRef.current;
    if (!player || playingId !== id) {
      return;
    }
    const safeTime = Math.max(0, Math.min(nextTime, currentDuration || 0));
    player.currentTime = safeTime;
    setCurrentTime(safeTime);
  }

  function handleSkip(id: string, deltaSeconds: number) {
    if (playingId !== id) {
      return;
    }
    handleSeek(id, currentTime + deltaSeconds);
  }

  async function handlePlay(id: string) {
    const player = audioRef.current;
    const target = audioFiles.find(file => file.id === id)?.filePath;
    if (!player || !target) {
      logger.warn('audio', '未找到可播放的音频路径', { id });
      return;
    }

    if (playingId === id) {
      if (player.paused) {
        try {
          await player.play();
          setIsPlaying(true);
        } catch (err) {
          logger.error('audio', '恢复播放失败', err);
          onPlaybackError({
            title: '播放失败',
            text: err instanceof Error ? err.message : String(err),
            tone: 'error',
          });
        }
      } else {
        player.pause();
        setIsPlaying(false);
      }
      return;
    }

    try {
      setLoadingAudioId(id);
      const audioUrl = await loadAudioSource(target);

      player.pause();
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
      }
      audioObjectUrlRef.current = audioUrl;
      player.src = audioUrl;
      player.currentTime = 0;
      setPlayingId(id);
      setCurrentTime(0);
      setCurrentDuration(0);
      await player.play();
      setIsPlaying(true);
      logger.info('audio', '开始播放音频', { id, target });
    } catch (err) {
      resetAudioPlayback();
      logger.error('audio', '播放音频失败', err);
      onPlaybackError({
        title: '播放失败',
        text: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    }
  }

  return {
    playingId,
    isPlaying,
    currentTime,
    currentDuration,
    loadingAudioId,
    resetAudioPlayback,
    handleSeek,
    handleSkip,
    handlePlay,
  };
}
