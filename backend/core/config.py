"""配置管理，优先从系统应用支持目录与数据库加载运行时配置。"""

import os
import shutil
import sys
from pathlib import Path

from loguru import logger
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
    return _base_storage_root() / _APP_IDENTIFIER / "backend"


def legacy_storage_dir() -> Path:
    """返回历史遗留的应用支持目录。"""
    return _base_storage_root() / _LEGACY_APP_NAME / "backend"


def migrate_legacy_storage_dir() -> None:
    """将旧目录中的数据安全迁移到新目录。"""
    legacy_dir = legacy_storage_dir()
    target_dir = default_storage_dir()

    if legacy_dir == target_dir or not legacy_dir.exists():
        return

    target_dir.mkdir(parents=True, exist_ok=True)

    for source in legacy_dir.iterdir():
        destination = target_dir / source.name
        if destination.exists():
            logger.info(f"跳过旧目录迁移项（目标已存在）: {destination}")
            continue
        shutil.move(str(source), str(destination))
        logger.info(f"已迁移旧目录数据: {source} -> {destination}")

    try:
        legacy_dir.rmdir()
        logger.info(f"已移除空旧目录: {legacy_dir}")
    except OSError:
        logger.info(f"旧目录仍保留（存在未迁移内容）: {legacy_dir}")


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
