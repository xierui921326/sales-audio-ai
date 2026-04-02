"""AudioFile ORM 模型。"""

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class AudioFile(Base):
    """音频文件表，关联到 DialogScript。"""

    __tablename__ = "audio_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    script_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("dialog_scripts.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)

    script: Mapped["DialogScript"] = relationship(  # noqa: F821
        "DialogScript", back_populates="audio_file"
    )
