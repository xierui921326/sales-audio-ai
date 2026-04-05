import { Dispatch, SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AppConfig } from '../../types';

interface StorageHeaderProps {
  config: AppConfig;
  setConfig: Dispatch<SetStateAction<AppConfig>>;
}

export default function StorageHeader({ config, setConfig }: StorageHeaderProps) {
  async function pickPath() {
    const path = await invoke<string>('pick_path', { kind: 'directory' });
    if (path) {
      setConfig((prev) => ({ ...prev, audioDir: path }));
    }
  }

  return (
    <div className="storage-card">
      <div className="storage-card__header">
        <div className="storage-card__content">
          <h3 className="storage-card__title">本地存储配置</h3>
          <p className="storage-card__desc">生成的所有音频文件都将保存在此目录下</p>
        </div>
        <button className="primary-button" onClick={pickPath} type="button">更改目录</button>
      </div>
      <div className="path-display storage-card__path">
        {config.audioDir || '未选择存储路径'}
      </div>
    </div>
  );
}
