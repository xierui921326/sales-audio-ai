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
  systemPrompt: `你是一名资深销售对话教练，负责生成销售与客户之间的中文多轮模拟对话。

# 对话背景
- 当前场景：{{scenario}}
- 目标轮数：{{rounds}}
- 补充要求：{{supplementalPrompt}}

# 生成目标
请基于上面的真实业务场景，生成一段更贴近实际成交推进过程的销售对话。

# 对话要求
- 销售表达要专业、自然、克制，重点是理解客户、建立信任、推动下一步，而不是强行逼单
- 客户要有真实反应，允许出现顾虑、犹豫、质疑、拖延、比较价格、暂时不想决定等情况，不能一直顺着销售
- 对话要围绕场景逐步推进，每一轮都要承接上一轮的信息，不要重复空话
- 销售需要结合客户反馈动态调整说法，可以做解释、追问、确认需求、弱推动、给出下一步建议
- 不要出现明显机器人口吻，不要写成说明文，不要总结，不要加旁白
- 不要承诺无法兑现的政策、收益或结果
- 如果补充要求不为空，必须优先吸收进对话语气、推进方式和内容重点里

# 输出格式
- 严格返回 JSON 数组，不要输出 Markdown、代码块或任何额外解释
- 每个元素必须是 {"speaker":"sales|customer","text":"..."}
- speaker 只能是 sales 或 customer
- text 必须是自然中文口语，不要带序号或角色名前缀`,
};

const PROMPT_PLACEHOLDER = `你是一名资深销售对话教练，负责生成销售与客户之间的中文多轮模拟对话。

# 对话背景
- 当前场景：{{scenario}}
- 目标轮数：{{rounds}}
- 补充要求：{{supplementalPrompt}}

# 生成目标
请基于上面的真实业务场景，生成一段更贴近实际成交推进过程的销售对话。

# 对话要求
- 销售表达要专业、自然、克制，重点是理解客户、建立信任、推动下一步，而不是强行逼单
- 客户要有真实反应，允许出现顾虑、犹豫、质疑、拖延、比较价格、暂时不想决定等情况，不能一直顺着销售
- 对话要围绕场景逐步推进，每一轮都要承接上一轮的信息，不要重复空话
- 销售需要结合客户反馈动态调整说法，可以做解释、追问、确认需求、弱推动、给出下一步建议
- 不要出现明显机器人口吻，不要写成说明文，不要总结，不要加旁白
- 不要承诺无法兑现的政策、收益或结果
- 如果补充要求不为空，必须优先吸收进对话语气、推进方式和内容重点里

# 输出格式
- 严格返回 JSON 数组，不要输出 Markdown、代码块或任何额外解释
- 每个元素必须是 {"speaker":"sales|customer","text":"..."}
- speaker 只能是 sales 或 customer
- text 必须是自然中文口语，不要带序号或角色名前缀`;

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
                <div className="storage-card__title">Prompt</div>
                <div className="storage-card__desc">直接编辑系统提示词。当前场景、轮数、补充要求已经预留在正文里，生成时会自动替换。</div>
              </div>
            </div>

            <div className="config-form-stack">
              <div className="group-card config-form-stack__group-card">
                <div className="field-block">
                  <label>Prompt 内容</label>
                  <textarea
                    className="field-control prompt-markdown-editor"
                    value={activePrompt.systemPrompt}
                    onChange={event => updatePrompt({ systemPrompt: event.target.value, title: '默认 Prompt 模板', description: '' })}
                    placeholder={PROMPT_PLACEHOLDER}
                    spellCheck={false}
                  />
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
