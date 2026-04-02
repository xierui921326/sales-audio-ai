"""配置管理，基于 pydantic-settings 从 .env 读取环境变量。"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用全局配置。"""

    openai_api_key: str = ""
    llm_model: str = "gpt-4o"
    base_url: str = "https://api.openai.com/v1"

    # 存储根目录（相对于 backend/）
    storage_dir: Path = Path("storage")

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
    def db_url(self) -> str:
        """SQLite 数据库连接 URL。"""
        return f"sqlite:///{self.storage_dir / 'app.db'}"


settings = Settings()
