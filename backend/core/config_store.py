"""应用配置数据库持久化。"""

import sqlite3
from pathlib import Path

from core.logger import logger

from core.config import settings

_CONFIG_KEY = "runtime_config"


def init_config_db() -> None:
    """初始化配置表。"""
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_config (
                config_key TEXT PRIMARY KEY,
                config_value TEXT NOT NULL
            )
            """
        )
        conn.commit()


def load_runtime_config() -> None:
    """从 SQLite 加载运行时配置，缺失时保留当前默认值。"""
    init_config_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT config_value FROM app_config WHERE config_key = ?",
            (_CONFIG_KEY,),
        ).fetchone()

    if not row:
        return

    payload = _parse_payload(row[0])
    settings.openai_api_key = payload.get("openai_api_key", settings.openai_api_key)
    settings.llm_model = payload.get("llm_model", settings.llm_model)
    settings.base_url = payload.get("base_url", settings.base_url)
    settings.tts_voice_sales = payload.get("tts_voice_sales", settings.tts_voice_sales)
    settings.tts_voice_customer = payload.get("tts_voice_customer", settings.tts_voice_customer)
    logger.info("已从 SQLite 加载运行时配置")


def save_runtime_config(*, openai_api_key: str, llm_model: str, base_url: str, tts_voice_sales: str, tts_voice_customer: str) -> None:
    """将运行时配置写入 SQLite。"""
    init_config_db()
    payload = {
        "openai_api_key": openai_api_key,
        "llm_model": llm_model,
        "base_url": base_url,
        "tts_voice_sales": tts_voice_sales,
        "tts_voice_customer": tts_voice_customer,
    }

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO app_config(config_key, config_value)
            VALUES (?, ?)
            ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value
            """,
            (_CONFIG_KEY, _stringify_payload(payload)),
        )
        conn.commit()


def _connect() -> sqlite3.Connection:
    db_path: Path = settings.db_path
    if db_path.parent:
        db_path.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(db_path)


def _parse_payload(raw: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in raw.splitlines():
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key] = value
    return result


def _stringify_payload(payload: dict[str, str]) -> str:
    return "\n".join(f"{key}={value}" for key, value in payload.items())
