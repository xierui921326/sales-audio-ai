import React, { useEffect } from 'react';
import ConfigPlaceholder from '../components/config/ConfigPlaceholder';
import { PromptTemplate } from '../types';

interface PromptConfigPageProps {
  prompts: PromptTemplate[];
  setPrompts: React.Dispatch<React.SetStateAction<PromptTemplate[]>>;
  onSavePrompts: () => Promise<void>;
  promptSaveState: 'idle' | 'saving' | 'success' | 'error';
  hasUnsavedPromptChanges: boolean;
}

const FALLBACK_PROMPT: PromptTemplate = {
  id: 'default-prompt',
  title: '默认 Prompt 模板',
  description: '',
  systemPrompt: '你是一名资深销售教练。请根据输入生成自然、专业、真实的中文销售对话，严格返回 JSON 数组，不要额外解释。数组元素格式：{"speaker":"sales|customer","text":"..."}。',
};

export default function PromptConfigPage({ prompts, setPrompts, onSavePrompts, promptSaveState, hasUnsavedPromptChanges }: PromptConfigPageProps) {
  const activePrompt = prompts[0];

  useEffect(() => {
    if (prompts.length === 0) {
      setPrompts([FALLBACK_PROMPT]);
    } else if (prompts.length > 1) {
      setPrompts([prompts[0]]);
    }
  }, [prompts, setPrompts]);

  function updatePrompt(partial: Partial<PromptTemplate>) {
    setPrompts(prev => {
      const current = prev[0] ?? FALLBACK_PROMPT;
      return [{ ...current, ...partial }];
    });
  }

  return (
    <div className="page-stage animate-slide-up">
      <section className="config-page-card storage-card">
        {!activePrompt ? (
          <ConfigPlaceholder message="正在准备 Prompt 模板" />
        ) : (
          <div className="config-form-wrapper">
            <div className="storage-card__header">
              <div className="storage-card__content">
                <div className="storage-card__title">Prompt 模板</div>
                <div className="storage-card__desc">使用 Markdown 风格编辑系统提示词，生成对话时会始终自动使用这里的内容。</div>
              </div>
            </div>

            <div className="config-form-stack">
              <div className="group-card config-form-stack__group-card">
                <div className="field-block">
                  <label>System Prompt Markdown</label>
                  <textarea
                    className="field-control prompt-markdown-editor"
                    value={activePrompt.systemPrompt}
                    onChange={event => updatePrompt({ systemPrompt: event.target.value, title: '默认 Prompt 模板', description: '' })}
                    placeholder={'例如：\n# 角色\n你是一名资深销售教练\n\n# 任务\n根据输入生成自然、专业、真实的中文销售对话\n\n# 输出要求\n- 严格返回 JSON 数组\n- 不要额外解释\n- speaker 只能是 sales 或 customer'}
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="config-inline-action-bar config-inline-action-bar--inside-card">
                <div className="config-inline-action-bar__text">
                  支持按 Markdown 结构组织角色、目标、约束和输出格式；若正文留空，生成时会回退到系统内置 Prompt。
                </div>
              </div>

              <div className="config-save-row">
                <button className="btn-save" onClick={onSavePrompts} disabled={promptSaveState === 'saving'} type="button">
                  {promptSaveState === 'saving' ? '保存中...' : promptSaveState === 'error' ? '保存失败，请重试' : promptSaveState === 'success' && !hasUnsavedPromptChanges ? '已保存' : '保存 Prompt 模板'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
