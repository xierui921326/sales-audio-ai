"""配置管理，优先从系统应用支持目录与数据库加载运行时配置。"""

import os
import shutil
import sys
from pathlib import Path

from core.logger import logger
from pydantic_settings import BaseSettings, SettingsConfigDict


_APP_IDENTIFIER = "com.xier.sales-audio-ai"
_LEGACY_APP_NAME = "Sales Audio AI"


def _base_storage_root() -> Path:
    """返回跨平台的应用支持根目录。"""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support"
    if sys.platform.startswith("win"):
        appdata = os.environ.get("APPDATA")
        return Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"

    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    return Path(xdg_data_home) if xdg_data_home else Path.home() / ".local" / "share"


def default_storage_dir() -> Path:
    """返回跨平台的应用支持目录。"""
    return _base_storage_root() / _APP_IDENTIFIER


def legacy_storage_dir() -> Path:
    """返回历史遗留的旧 backend 子目录。"""
    return _base_storage_root() / _LEGACY_APP_NAME / "backend"


def legacy_root_storage_dir() -> Path:
    """返回历史遗留的旧应用根目录。"""
    return _base_storage_root() / _LEGACY_APP_NAME


def nested_storage_dir() -> Path:
    """返回当前应用下遗留的 backend 子目录。"""
    return default_storage_dir() / "backend"


def _merge_db_file(source: Path, destination: Path) -> None:
    if not source.exists():
        return
    if destination.exists():
        logger.info(f"跳过旧数据库迁移（目标已存在）: {source} -> {destination}")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(destination))
    logger.info(f"已迁移旧数据库: {source} -> {destination}")


def _merge_audio_dir(source: Path, destination: Path) -> None:
    if not source.exists() or not source.is_dir():
        return

    destination.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        target = destination / item.name
        if target.exists():
            logger.info(f"跳过旧音频迁移项（目标已存在）: {item} -> {target}")
            continue
        shutil.move(str(item), str(target))
        logger.info(f"已迁移旧音频文件: {item} -> {target}")


def _cleanup_empty_dir(path: Path) -> None:
    if not path.exists() or not path.is_dir():
        return
    try:
        path.rmdir()
        logger.info(f"已移除空目录: {path}")
    except OSError:
        logger.info(f"目录仍保留（存在未迁移内容）: {path}")


def migrate_legacy_storage_dir() -> None:
    """将旧目录中的数据库与音频安全归并到统一目录。"""
    target_dir = default_storage_dir()
    target_dir.mkdir(parents=True, exist_ok=True)

    legacy_root_dir = legacy_root_storage_dir()
    legacy_backend_dir = legacy_storage_dir()
    nested_backend_dir = nested_storage_dir()

    _merge_db_file(legacy_root_dir / "app.db", target_dir / "app.db")
    _merge_audio_dir(legacy_root_dir / "audio", target_dir / "audio")

    _merge_db_file(legacy_backend_dir / "app.db", target_dir / "app.db")
    _merge_audio_dir(legacy_backend_dir / "audio", target_dir / "audio")

    _merge_db_file(nested_backend_dir / "app.db", target_dir / "app.db")
    _merge_audio_dir(nested_backend_dir / "audio", target_dir / "audio")

    _cleanup_empty_dir(legacy_backend_dir / "audio")
    _cleanup_empty_dir(legacy_backend_dir)
    _cleanup_empty_dir(legacy_root_dir / "audio")
    _cleanup_empty_dir(legacy_root_dir)
    _cleanup_empty_dir(nested_backend_dir / "audio")
    _cleanup_empty_dir(nested_backend_dir)


class Settings(BaseSettings):
    """应用全局配置。"""

    openai_api_key: str = ""
    llm_model: str = "gpt-4o"
    base_url: str = "https://api.openai.com/v1"
    tts_voice_sales: str = "zh-CN-YunxiNeural"
    tts_voice_customer: str = "zh-CN-XiaoyiNeural"
    storage_dir: Path = default_storage_dir()

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def audio_path(self) -> Path:
        """音频文件存储目录。"""
        return self.storage_dir / "audio"

    @property
    def db_path(self) -> Path:
        """SQLite 数据库文件路径。"""
        return self.storage_dir / "app.db"

    @property
    def db_url(self) -> str:
        """SQLite 数据库连接 URL。"""
        return f"sqlite:///{self.db_path}"


settings = Settings()
