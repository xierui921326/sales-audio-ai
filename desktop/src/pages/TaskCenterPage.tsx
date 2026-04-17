import React from 'react';
import { AudioGenerationTaskItem } from '../types';

interface TaskCenterPageProps {
  audioGenerationTasks: AudioGenerationTaskItem[];
  formatTaskTime: (value: string) => string;
  onRetryAudioTask: (taskId: string) => Promise<void>;
  busy: boolean;
}

type TaskStatusTone = 'success' | 'warning' | 'neutral';

interface TaskStatusMeta {
  label: string;
  tone: TaskStatusTone;
}

function getTaskStatusMeta(status: AudioGenerationTaskItem['status']): TaskStatusMeta {
  switch (status) {
    case 'completed':
      return { label: '已完成', tone: 'success' };
    case 'partial_failed':
      return { label: '部分失败', tone: 'warning' };
    case 'processing':
      return { label: '生成中', tone: 'neutral' };
    default:
      return { label: '等待中', tone: 'neutral' };
  }
}

function getTaskFailureSummary(task: AudioGenerationTaskItem): string | null {
  const firstFailedSegment = task.segments.find(segment => segment.status === 'failed' && segment.errorMessage?.trim());
  const message = firstFailedSegment?.errorMessage?.trim() || task.lastError?.trim();
  if (!message) {
    return null;
  }

  return message.length > 120 ? `${message.slice(0, 120)}...` : message;
}

function getPendingSegmentCount(task: AudioGenerationTaskItem): number {
  return Math.max(0, task.totalSegments - task.successSegments - task.failedSegments);
}

function getOverviewItems(tasks: AudioGenerationTaskItem[]) {
  return [
    {
      label: '总任务',
      value: tasks.length,
      tone: 'neutral' as const,
    },
    {
      label: '处理中',
      value: tasks.filter(task => task.status === 'processing' || task.status === 'pending').length,
      tone: 'neutral' as const,
    },
    {
      label: '失败',
      value: tasks.filter(task => task.status === 'partial_failed').length,
      tone: 'warning' as const,
    },
    {
      label: '完成',
      value: tasks.filter(task => task.status === 'completed').length,
      tone: 'success' as const,
    },
  ];
}

export default function TaskCenterPage({ audioGenerationTasks, formatTaskTime, onRetryAudioTask, busy }: TaskCenterPageProps) {
  const [detailTaskId, setDetailTaskId] = React.useState<string | null>(null);

  const overviewItems = React.useMemo(() => getOverviewItems(audioGenerationTasks), [audioGenerationTasks]);
  const detailTask = React.useMemo(() => audioGenerationTasks.find(task => task.id === detailTaskId) ?? null, [audioGenerationTasks, detailTaskId]);
  const detailTaskStatusMeta = detailTask ? getTaskStatusMeta(detailTask.status) : null;

  React.useEffect(() => {
    if (!detailTaskId) {
      return;
    }

    if (!audioGenerationTasks.some(task => task.id === detailTaskId)) {
      setDetailTaskId(null);
    }
  }, [audioGenerationTasks, detailTaskId]);

  React.useEffect(() => {
    if (!detailTask) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDetailTaskId(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailTask]);

  function handleRetryClick(taskId: string) {
    onRetryAudioTask(taskId).catch(() => undefined);
  }

  return (
    <>
      <div className="page-view task-center-page animate-fade-in">
        <section className="task-center-hero storage-card">
          <div className="task-center-hero__title-wrap">
            <div className="storage-card__title">任务中心</div>
            <div className="task-center-hero__divider" />
            <div className="storage-card__desc task-center-hero__desc">集中查看分片音频任务状态、更新时间、成功数量与失败原因，生成页只保留轻量入口。</div>
          </div>
          <div className="task-center-hero__meta">共 {audioGenerationTasks.length} 个任务记录</div>
        </section>

        <div className="task-center-page__overview">
          {overviewItems.map(item => (
            <article className={`task-overview-card task-overview-card--${item.tone}`} key={item.label}>
              <div className="task-overview-card__label">{item.label}</div>
              <strong className="task-overview-card__value">{item.value}</strong>
            </article>
          ))}
        </div>

        <section className="storage-card task-center-panel">
          <div className="storage-card__header task-center-panel__header">
            <div className="storage-card__content">
              <div className="storage-card__title">任务列表</div>
              <div className="storage-card__desc">按最近更新时间展示任务卡片，可查看片段详情，并对失败片段执行重试。</div>
            </div>
          </div>

          {audioGenerationTasks.length === 0 ? (
            <div className="empty-state task-center-empty-state">
              <p className="empty-state__text">当前还没有任务记录。请先前往“生成对话”页发起一次音频合成任务。</p>
            </div>
          ) : (
            <div className="task-center-list">
              {audioGenerationTasks.map(task => {
                const statusMeta = getTaskStatusMeta(task.status);
                const failureSummary = getTaskFailureSummary(task);
                const pendingSegments = getPendingSegmentCount(task);
                const canRetryTask = task.status === 'partial_failed' && !busy;

                return (
                  <article className="task-card" key={task.id}>
                    <div className="task-card__top">
                      <div className="task-card__meta">
                        <div className="task-card__summary-row">
                          <div className="task-card__summary-main">
                            <span className="task-card__title">任务 ID</span>
                            <div className="task-card__id" title={task.id}>{task.id}</div>
                          </div>
                        </div>
                        <div className="task-card__time">最近更新：{formatTaskTime(task.updatedAt)}</div>
                      </div>

                      <div className="task-card__actions">
                        <span className={`generate-task-status generate-task-status--${statusMeta.tone}`}>{statusMeta.label}</span>
                        <button className="chip-button strong-secondary compact-chip-button" type="button" onClick={() => setDetailTaskId(task.id)}>
                          查看详情
                        </button>
                        {task.status === 'partial_failed' ? (
                          <button
                            className="chip-button strong-secondary compact-chip-button"
                            type="button"
                            disabled={!canRetryTask}
                            onClick={() => handleRetryClick(task.id)}
                          >
                            {busy ? '处理中...' : '重试失败片段'}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="generate-task-metrics task-card__metrics">
                      <div className="generate-task-metric">
                        <span className="generate-task-metric__label">总片段</span>
                        <strong>{task.totalSegments}</strong>
                      </div>
                      <div className="generate-task-metric generate-task-metric--success">
                        <span className="generate-task-metric__label">成功</span>
                        <strong>{task.successSegments}</strong>
                      </div>
                      <div className="generate-task-metric generate-task-metric--warning">
                        <span className="generate-task-metric__label">失败</span>
                        <strong>{task.failedSegments}</strong>
                      </div>
                      <div className="generate-task-metric">
                        <span className="generate-task-metric__label">处理中</span>
                        <strong>{pendingSegments}</strong>
                      </div>
                    </div>

                    {failureSummary ? <div className="task-card__error-inline">最近错误：{failureSummary}</div> : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {detailTask ? (
        <div className="task-detail-modal" role="dialog" aria-modal="true" aria-labelledby="task-detail-modal-title" onClick={() => setDetailTaskId(null)}>
          <div className="task-detail-modal__panel" onClick={event => event.stopPropagation()}>
            <div className="task-detail-modal__header">
              <div className="task-detail-modal__header-main">
                <div className="task-detail-modal__title" id="task-detail-modal-title">任务详情</div>
                <div className="task-detail-modal__task-id" title={detailTask.id}>{detailTask.id}</div>
              </div>
              <button className="chip-button strong-secondary compact-chip-button" type="button" onClick={() => setDetailTaskId(null)}>
                关闭
              </button>
            </div>

            <div className="task-detail-modal__meta">
              <span className={`generate-task-status generate-task-status--${detailTaskStatusMeta?.tone}`}>{detailTaskStatusMeta?.label}</span>
              <div className="task-detail-modal__meta-text">最近更新：{formatTaskTime(detailTask.updatedAt)}</div>
            </div>

            <div className="task-card__detail">
              <div className="task-card__detail-header">分片详情</div>
              <div className="task-segment-list">
                {detailTask.segments.map(segment => {
                  const segmentTone = segment.status === 'succeeded' ? 'success' : segment.status === 'failed' ? 'warning' : 'neutral';
                  const segmentLabel = segment.status === 'succeeded' ? '成功' : segment.status === 'failed' ? '失败' : segment.status === 'processing' ? '生成中' : '等待中';

                  return (
                    <div className="task-segment-item" key={segment.id}>
                      <div className="task-segment-item__top">
                        <div className="task-segment-item__title">片段 {segment.segmentIndex + 1} · {segment.speaker}</div>
                        <span className={`generate-task-status generate-task-status--${segmentTone}`}>{segmentLabel}</span>
                      </div>
                      <div className="task-segment-item__text">{segment.text}</div>
                      <div className="task-segment-item__foot">尝试次数：{segment.attemptCount} · 更新时间：{formatTaskTime(segment.updatedAt)}</div>
                      {segment.errorMessage?.trim() ? <div className="task-segment-item__error">{segment.errorMessage.trim()}</div> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
