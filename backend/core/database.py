"""数据库初始化与会话管理。"""

from collections.abc import Generator

from loguru import logger
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from core.config import settings


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


def init_db() -> None:
    """创建所有数据表（如不存在）。"""
    # 延迟导入，确保模型已注册到 Base.metadata
    import models.audio_file  # noqa: F401
    import models.dialog_script  # noqa: F401
    import models.dialog_task  # noqa: F401

    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    engine = _get_engine()
    Base.metadata.create_all(bind=engine)
    logger.info("数据库初始化完成")


def _get_engine():
    return create_engine(
        settings.db_url,
        connect_args={"check_same_thread": False},
    )


_engine = None
_SessionLocal = None


def _ensure_session_factory():
    global _engine, _SessionLocal
    if _SessionLocal is None:
        _engine = _get_engine()
        _SessionLocal = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依赖注入：提供数据库会话。"""
    _ensure_session_factory()
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()
