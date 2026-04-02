"""DialogTask ORM 模型。"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class DialogTask(Base):
    """销售对话任务表。"""

    __tablename__ = "dialog_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    industry: Mapped[str] = mapped_column(String, nullable=False)
    scene: Mapped[str] = mapped_column(String, nullable=False)
    customer_role: Mapped[str] = mapped_column(String, nullable=False)
    tone: Mapped[str] = mapped_column(String, nullable=False, default="专业")
    rounds: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    scripts: Mapped[list["DialogScript"]] = relationship(  # noqa: F821
        "DialogScript",
        back_populates="task",
        order_by="DialogScript.order_index",
        cascade="all, delete-orphan",
    )
