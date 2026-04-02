"""配置管理 API：读取和更新运行时配置（持久化到 .env）。"""

from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from core.config import settings

router = APIRouter(prefix="/config", tags=["config"])

_ENV_FILE = Path(__file__).parent.parent / ".env"


class LLMConfig(BaseModel):
    """LLM 配置项。"""
    provider: str = "openai"
    model: str
    api_key: str
    base_url: str


class TTSVoiceConfig(BaseModel):
    """TTS 声音映射。"""
    sales: str
    customer: str


class TTSConfig(BaseModel):
    """TTS 配置项。"""
    provider: str = "edge_tts"
    voices: TTSVoiceConfig


class StorageConfig(BaseModel):
    """存储配置项。"""
    storage_dir: str


class AppConfig(BaseModel):
    """完整应用配置。"""
    llm: LLMConfig
    tts: TTSConfig
    storage: StorageConfig


@router.get("", response_model=AppConfig)
def get_config() -> AppConfig:
    """获取当前运行时配置。"""
    from services.tts_service import VOICE_MAP
    return AppConfig(
        llm=LLMConfig(
            provider="openai",
            model=settings.llm_model,
            api_key=settings.openai_api_key,
            base_url=settings.base_url,
        ),
        tts=TTSConfig(
            provider="edge_tts",
            voices=TTSVoiceConfig(
                sales=VOICE_MAP.get("sales", "zh-CN-YunxiNeural"),
                customer=VOICE_MAP.get("customer", "zh-CN-XiaoyiNeural"),
            ),
        ),
        storage=StorageConfig(
            storage_dir=str(settings.storage_dir),
        ),
    )


@router.post("", response_model=AppConfig)
def update_config(cfg: AppConfig) -> AppConfig:
    """更新配置并持久化到 .env 文件。"""
    _write_env({
        "OPENAI_API_KEY": cfg.llm.api_key,
        "LLM_MODEL": cfg.llm.model,
        "BASE_URL": cfg.llm.base_url,
        "STORAGE_DIR": cfg.storage.storage_dir,
        "TTS_VOICE_SALES": cfg.tts.voices.sales,
        "TTS_VOICE_CUSTOMER": cfg.tts.voices.customer,
    })
    # 更新内存中的 settings
    settings.openai_api_key = cfg.llm.api_key
    settings.llm_model = cfg.llm.model
    settings.base_url = cfg.llm.base_url

    # 更新 TTS 声音映射
    from services.tts_service import VOICE_MAP
    VOICE_MAP["sales"] = cfg.tts.voices.sales
    VOICE_MAP["customer"] = cfg.tts.voices.customer

    # 更新 LLM 客户端
    from services.llm_service import llm_service
    from openai import AsyncOpenAI
    llm_service._client = AsyncOpenAI(
        api_key=cfg.llm.api_key,
        base_url=cfg.llm.base_url,
    )

    return get_config()


def _write_env(kv: dict[str, str]) -> None:
    """将键值对写入 .env 文件，已存在的 key 覆盖，新 key 追加。"""
    lines: list[str] = []
    existing_keys: set[str] = set()

    if _ENV_FILE.exists():
        for line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                key = stripped.split("=", 1)[0].strip()
                if key in kv:
                    lines.append(f"{key}={kv[key]}")
                    existing_keys.add(key)
                    continue
            lines.append(line)

    for key, val in kv.items():
        if key not in existing_keys:
            lines.append(f"{key}={val}")

    _ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
