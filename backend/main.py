"""FastAPI 应用入口。

启动方式：
    uvicorn main:app --reload
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from api.audio_controller import router as audio_router
from api.config_controller import router as config_router
from api.dialog_controller import router as dialog_router
from core.config import settings
from core.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动时初始化数据库和存储目录。"""
    _ensure_dirs()
    init_db()
    logger.info("sales-audio-ai 启动完成")
    yield
    logger.info("sales-audio-ai 关闭")


def _ensure_dirs() -> None:
    """创建必要的存储目录。"""
    dirs: list[Path] = [settings.storage_dir, settings.audio_path]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
    logger.info(f"存储目录就绪: {settings.audio_path}")


app = FastAPI(
    title="Sales Audio AI",
    description="销售对话与音频自动生成系统",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dialog_router)
app.include_router(audio_router)
app.include_router(config_router)


@app.get("/health")
def health() -> dict:
    """健康检查接口。"""
    return {"status": "ok"}
