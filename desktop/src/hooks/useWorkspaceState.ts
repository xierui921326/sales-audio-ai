import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AppConfig, PromptTemplate, WorkspaceData } from '../types';
import { logger } from '../utils/logger';

const DEFAULT_CONFIG: AppConfig = {
  activeLlmId: '',
  llmEndpoints: [],
  activeTtsId: '',
  ttsEndpoints: [],
  activePromptId: '',
  audioDir: '',
  databasePath: '',
  configFile: '',
};

const DEFAULT_PROMPTS: PromptTemplate[] = [];

let initialWorkspacePromise: Promise<WorkspaceData> | null = null;

type SaveState = 'idle' | 'saving' | 'success' | 'error';

interface UseWorkspaceStateResult {
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  savedConfigSnapshot: AppConfig;
  prompts: PromptTemplate[];
  setPrompts: React.Dispatch<React.SetStateAction<PromptTemplate[]>>;
  configSaveState: SaveState;
  promptSaveState: SaveState;
  configLoaded: boolean;
  hasUnsavedChanges: boolean;
  hasUnsavedPromptChanges: boolean;
  handleSaveConfig: () => Promise<void>;
  handleSavePrompts: () => Promise<void>;
}

function loadInitialWorkspace(): Promise<WorkspaceData> {
  if (!initialWorkspacePromise) {
    logger.info('app', '开始加载工作区');
    initialWorkspacePromise = invoke<WorkspaceData>('load_workspace')
      .then((workspace) => {
        logger.info('app', '工作区加载完成', {
          llmCount: workspace.config.llmEndpoints.length,
          ttsCount: workspace.config.ttsEndpoints.length,
          promptCount: workspace.prompts.length,
        });
        return workspace;
      })
      .catch((err) => {
        logger.error('app', '加载工作区失败', err);
        initialWorkspacePromise = null;
        throw err;
      });
  }

  return initialWorkspacePromise;
}

export function useWorkspaceState(): UseWorkspaceStateResult {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [configSaveState, setConfigSaveState] = useState<SaveState>('idle');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [savedConfigSnapshot, setSavedConfigSnapshot] = useState<AppConfig>(DEFAULT_CONFIG);
  const [prompts, setPrompts] = useState<PromptTemplate[]>(DEFAULT_PROMPTS);
  const [savedPromptsSnapshot, setSavedPromptsSnapshot] = useState<PromptTemplate[]>(DEFAULT_PROMPTS);
  const [promptSaveState, setPromptSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const workspace = await loadInitialWorkspace();
        if (cancelled) {
          return;
        }
        setConfig(workspace.config);
        setSavedConfigSnapshot(workspace.config);
        setPrompts(workspace.prompts);
        setSavedPromptsSnapshot(workspace.prompts);
      } finally {
        if (!cancelled) {
          setConfigLoaded(true);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const hasUnsavedChanges = useMemo(() => {
    if (!configLoaded) {
      return false;
    }

    return JSON.stringify(config) !== JSON.stringify(savedConfigSnapshot);
  }, [config, configLoaded, savedConfigSnapshot]);

  const hasUnsavedPromptChanges = useMemo(() => {
    if (!configLoaded) {
      return false;
    }

    return JSON.stringify(prompts) !== JSON.stringify(savedPromptsSnapshot);
  }, [configLoaded, prompts, savedPromptsSnapshot]);

  useEffect(() => {
    if (promptSaveState === 'success' || promptSaveState === 'error') {
      setPromptSaveState('idle');
    }
  }, [prompts, promptSaveState]);

  useEffect(() => {
    if (configSaveState === 'success' || configSaveState === 'error') {
      setConfigSaveState('idle');
    }
  }, [config, configSaveState]);

  async function handleSavePrompts() {
    if (!configLoaded) {
      return;
    }

    setPromptSaveState('saving');
    try {
      logger.info('prompt', '开始保存 Prompt 模板', { promptCount: prompts.length });
      const savedPrompts = await invoke<PromptTemplate[]>('save_prompts', { prompts });
      setPrompts(savedPrompts);
      setSavedPromptsSnapshot(savedPrompts);
      setPromptSaveState('success');
      logger.info('prompt', 'Prompt 模板保存成功', { promptCount: savedPrompts.length });
    } catch (err) {
      logger.error('prompt', 'Prompt 模板保存失败', err);
      setPromptSaveState('error');
    }
  }

  async function handleSaveConfig() {
    if (!configLoaded) {
      return;
    }

    setConfigSaveState('saving');
    try {
      logger.info('config', '开始保存配置');
      const savedConfig = await invoke<AppConfig>('save_config', { config });
      setConfig(savedConfig);
      setSavedConfigSnapshot(savedConfig);
      setConfigSaveState('success');
      logger.info('config', '配置保存成功');
    } catch (err) {
      logger.error('config', '配置保存失败', err);
      setConfigSaveState('error');
    }
  }

  return {
    config,
    setConfig,
    savedConfigSnapshot,
    prompts,
    setPrompts,
    configSaveState,
    promptSaveState,
    configLoaded,
    hasUnsavedChanges,
    hasUnsavedPromptChanges,
    handleSaveConfig,
    handleSavePrompts,
  };
}
