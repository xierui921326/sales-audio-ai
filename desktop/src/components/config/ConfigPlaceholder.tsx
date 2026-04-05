interface ConfigPlaceholderProps {
  message: string;
}

export default function ConfigPlaceholder({ message }: ConfigPlaceholderProps) {
  return (
    <div className="placeholder-empty">
      <div className="placeholder-icon" aria-hidden="true">
        <span className="placeholder-icon__shape" />
      </div>
      <div className="placeholder-empty__message">{message}</div>
      <div className="placeholder-empty__hint">
        当前修改仅在点击“保存配置”后写入本地工作区
      </div>
    </div>
  );
}
