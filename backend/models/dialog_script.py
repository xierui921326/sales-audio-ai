"""DialogScript ORM 模型。"""

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class DialogScript(Base):
    """对话脚本行表，关联到 DialogTask。"""

    __tablename__ = "dialog_scripts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("dialog_tasks.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    text: Mapped[str] = mapped_column(String, nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    task: Mapped["DialogTask"] = relationship(  # noqa: F821
        "DialogTask", back_populates="scripts"
    )
    audio_file: Mapped["AudioFile | None"] = relationship(  # noqa: F821
        "AudioFile",
        back_populates="script",
        uselist=False,
        cascade="all, delete-orphan",
    )
