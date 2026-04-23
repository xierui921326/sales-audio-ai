import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  ConversationCompletedEvent,
  ConversationDeltaEvent,
  ConversationFailedEvent,
  ConversationStartedEvent,
  ConversationStreamDeltaEvent,
  CONVERSATION_COMPLETED_EVENT,
  CONVERSATION_DELTA_EVENT,
  CONVERSATION_FAILED_EVENT,
  CONVERSATION_STARTED_EVENT,
  CONVERSATION_STREAM_DELTA_EVENT,
  GenerateConversationInput,
  GenerateConversationOutput,
  TranscriptSegment,
} from '../types';
import { logger } from '../utils/logger';

type GenerateDialogTone = 'error' | 'info' | 'success';

interface GenerateDialogInput {
  title: string;
  text: string;
  tone: GenerateDialogTone;
}

interface UseConversationGenerationOptions {
  setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
  setStreamingText: React.Dispatch<React.SetStateAction<string>>;
  setDisplayStreamingText: React.Dispatch<React.SetStateAction<string>>;
  setGenerateDialog: React.Dispatch<React.SetStateAction<GenerateDialogInput | null>>;
  setBusy: React.Dispatch<React.SetStateAction<{ generatingConversation: boolean; generatingAudio: boolean }>>;
  upsertTranscriptSegment: (current: TranscriptSegment[], incoming: TranscriptSegment) => TranscriptSegment[];
}

interface UseConversationGenerationResult {
  handleGenerateConversation: (params: GenerateConversationInput) => Promise<void>;
}

function createRequestId(): string {
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useConversationGeneration({
  setTranscript,
  setStreamingText,
  setDisplayStreamingText,
  setGenerateDialog,
  setBusy,
  upsertTranscriptSegment,
}: UseConversationGenerationOptions): UseConversationGenerationResult {
  const generateRequestIdRef = useRef<string | null>(null);
  const generateListenersRef = useRef<UnlistenFn[]>([]);
  const pendingStreamingDeltaRef = useRef('');
  const streamingFlushFrameRef = useRef<number | null>(null);

  function resetStreamingBuffer() {
    pendingStreamingDeltaRef.current = '';
    if (streamingFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(streamingFlushFrameRef.current);
      streamingFlushFrameRef.current = null;
    }
  }

  function flushPendingStreamingText() {
    streamingFlushFrameRef.current = null;
    const pendingDelta = pendingStreamingDeltaRef.current;
    if (!pendingDelta) {
      return;
    }

    pendingStreamingDeltaRef.current = '';
    setStreamingText(current => current + pendingDelta);
  }

  function scheduleStreamingTextFlush() {
    if (streamingFlushFrameRef.current !== null) {
      return;
    }

    streamingFlushFrameRef.current = window.requestAnimationFrame(() => {
      flushPendingStreamingText();
    });
  }

  function clearGenerateListeners() {
    const listeners = generateListenersRef.current;
    generateListenersRef.current = [];
    for (const unlisten of listeners) {
      void Promise.resolve(unlisten()).catch(err => {
        logger.warn('generate', '清理对话流监听失败', err);
      });
    }
  }

  useEffect(() => {
    return () => {
      resetStreamingBuffer();
      clearGenerateListeners();
    };
  }, []);

  async function handleGenerateConversation(params: GenerateConversationInput) {
    const requestId = createRequestId();
    generateRequestIdRef.current = requestId;
    resetStreamingBuffer();
    clearGenerateListeners();
    setBusy(current => ({ ...current, generatingConversation: true }));
    setGenerateDialog(null);
    setTranscript([]);
    setStreamingText('');
    setDisplayStreamingText('');

    try {
      const listeners = await Promise.all([
        listen<ConversationStartedEvent>(CONVERSATION_STARTED_EVENT, event => {
          if (event.payload.requestId !== generateRequestIdRef.current) {
            return;
          }
          resetStreamingBuffer();
          setStreamingText('');
          setDisplayStreamingText('');
          logger.info('generate', '开始接收流式对话', { rounds: event.payload.rounds, requestId: event.payload.requestId });
        }),
        listen<ConversationStreamDeltaEvent>(CONVERSATION_STREAM_DELTA_EVENT, event => {
          if (event.payload.requestId !== generateRequestIdRef.current) {
            return;
          }
          pendingStreamingDeltaRef.current += event.payload.textDelta;
          scheduleStreamingTextFlush();
        }),
        listen<ConversationDeltaEvent>(CONVERSATION_DELTA_EVENT, event => {
          if (event.payload.requestId !== generateRequestIdRef.current) {
            return;
          }
          setTranscript(current => upsertTranscriptSegment(current, event.payload.segment));
        }),
        listen<ConversationCompletedEvent>(CONVERSATION_COMPLETED_EVENT, event => {
          if (event.payload.requestId !== generateRequestIdRef.current) {
            return;
          }
          flushPendingStreamingText();
          resetStreamingBuffer();
          setTranscript(event.payload.transcript);
          setStreamingText('');
          setDisplayStreamingText('');
          logger.info('generate', '流式对话完成事件已接收', {
            transcriptSize: event.payload.transcript.length,
            requestId: event.payload.requestId,
          });
        }),
        listen<ConversationFailedEvent>(CONVERSATION_FAILED_EVENT, event => {
          if (event.payload.requestId !== generateRequestIdRef.current) {
            return;
          }
          resetStreamingBuffer();
          setTranscript([]);
          setStreamingText('');
          setDisplayStreamingText('');
          logger.warn('generate', '流式对话失败事件已接收', {
            message: event.payload.message,
            requestId: event.payload.requestId,
          });
        }),
      ]);
      generateListenersRef.current = listeners;

      logger.info('generate', '开始生成对话', {
        rounds: params.rounds,
        llmEndpointId: params.llmEndpointId ?? '',
        requestId,
      });
      const result = await invoke<GenerateConversationOutput>('generate_conversation', {
        input: {
          ...params,
          requestId,
        },
      });
      if (generateRequestIdRef.current === requestId) {
        setTranscript(result.transcript);
        setStreamingText('');
        setDisplayStreamingText('');
      }
      logger.info('generate', '生成对话成功', { transcriptSize: result.transcript.length, requestId });
    } catch (err) {
      resetStreamingBuffer();
      setTranscript([]);
      setStreamingText('');
      setDisplayStreamingText('');
      logger.error('generate', '生成对话失败', err);
      setGenerateDialog({
        title: '生成失败',
        text: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      resetStreamingBuffer();
      if (generateRequestIdRef.current === requestId) {
        setStreamingText('');
        setDisplayStreamingText('');
        generateRequestIdRef.current = null;
      }
      clearGenerateListeners();
      setBusy(current => ({ ...current, generatingConversation: false }));
    }
  }

  return {
    handleGenerateConversation,
  };
}
