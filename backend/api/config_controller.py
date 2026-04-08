"""配置管理 API：读取和更新运行时配置（持久化到 SQLite）。"""

from fastapi import APIRouter
from pydantic import BaseModel

from core.config import settings
from core.config_store import save_runtime_config

router = APIRouter(prefix="/config", tags=["config"])


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
                sales=VOICE_MAP.get("sales", settings.tts_voice_sales),
                customer=VOICE_MAP.get("customer", settings.tts_voice_customer),
            ),
        ),
        storage=StorageConfig(
            storage_dir=str(settings.storage_dir),
        ),
    )


@router.post("", response_model=AppConfig)
def update_config(cfg: AppConfig) -> AppConfig:
    """更新配置并持久化到 SQLite。"""
    save_runtime_config(
        openai_api_key=cfg.llm.api_key,
        llm_model=cfg.llm.model,
        base_url=cfg.llm.base_url,
        tts_voice_sales=cfg.tts.voices.sales,
        tts_voice_customer=cfg.tts.voices.customer,
    )

    settings.openai_api_key = cfg.llm.api_key
    settings.llm_model = cfg.llm.model
    settings.base_url = cfg.llm.base_url
    settings.tts_voice_sales = cfg.tts.voices.sales
    settings.tts_voice_customer = cfg.tts.voices.customer

    from services.tts_service import VOICE_MAP, refresh_audio_dir

    VOICE_MAP["sales"] = cfg.tts.voices.sales
    VOICE_MAP["customer"] = cfg.tts.voices.customer
    refresh_audio_dir()

    from services.llm_service import llm_service

    llm_service.refresh_client()

    return get_config()
