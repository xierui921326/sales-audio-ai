import { NavigationItemId } from '../../types';

const NAV_ITEMS = [
  { id: 'generate', label: '生成对话', iconClass: 'nav-icon-shape nav-icon-shape--generate', description: '基于 AI 模拟销售对话场景' },
  { id: 'audio', label: '音频管理', iconClass: 'nav-icon-shape nav-icon-shape--audio', description: '预览、播放并导出生成的音频' },
  { id: 'llm', label: 'LLM 配置', iconClass: 'nav-icon-shape nav-icon-shape--llm', description: '管理大语言模型 API 终端' },
  { id: 'tts', label: 'TTS 配置', iconClass: 'nav-icon-shape nav-icon-shape--tts', description: '管理语音合成服务商信息' },
  { id: 'prompt', label: 'Prompt 配置', iconClass: 'nav-icon-shape nav-icon-shape--llm', description: '管理系统 Prompt 模板与默认项' },
] as const;

interface SidebarProps {
  activeNav: NavigationItemId;
  onNavChange: (id: NavigationItemId) => void;
}

export default function Sidebar({ activeNav, onNavChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-logo" aria-hidden="true">
          <span className="brand-logo__mark" />
        </div>
        <span className="brand-title">SALES AUDIO</span>
      </div>

      <nav className="nav-list nav-list--primary">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavChange(item.id)}
            className={`nav-item ${activeNav === item.id ? 'is-active' : ''}`}
            type="button"
          >
            <div className="nav-item__icon" aria-hidden="true">
              <span className={item.iconClass} />
            </div>
            <div className="nav-item__body">
              <div className="nav-item__title-row">
                <span className="nav-item__label">{item.label}</span>
              </div>
              <span className="nav-item__desc">{item.description}</span>
            </div>
          </button>
        ))}
      </nav>

      <div className="sidebar-status-card sidebar-status-card--compact">
        <div className="sidebar-status-row">
          <span className="status-dot status-dot--ready"></span>
          <span className="status-text">系统就绪</span>
        </div>
      </div>
    </aside>
  );
}
