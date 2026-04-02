"""对话生成 API 控制器。"""

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from models.dialog_script import DialogScript
from models.dialog_task import DialogTask
from services.dialog_parser import parse_dialog
from services.llm_service import llm_service
from services.prompt_builder import build_dialog_prompt

router = APIRouter(prefix="/dialog", tags=["dialog"])


class GenerateRequest(BaseModel):
    """生成对话请求体。"""

    industry: str = Field(..., description="行业名称")
    scene: str = Field(..., description="销售场景")
    customer_role: str = Field(..., description="客户角色")
    tone: str = Field(default="专业", description="对话语气")
    rounds: int = Field(default=8, ge=1, le=30, description="对话轮数")


class GenerateResponse(BaseModel):
    """生成对话响应体。"""

    task_id: int
    message: str


@router.post("/generate", response_model=GenerateResponse)
async def generate_dialog(
    req: GenerateRequest, db: Session = Depends(get_db)
) -> GenerateResponse:
    """生成多轮销售对话并存库。"""
    task = DialogTask(
        industry=req.industry,
        scene=req.scene,
        customer_role=req.customer_role,
        tone=req.tone,
        rounds=req.rounds,
        status="generating",
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    try:
        prompt = build_dialog_prompt(
            req.industry, req.scene, req.customer_role, req.tone, req.rounds
        )
        raw = await llm_service.generate_dialog(prompt)
        lines = parse_dialog(raw)

        for idx, line in enumerate(lines):
            db.add(
                DialogScript(
                    task_id=task.id,
                    role=line["role"],
                    text=line["text"],
                    order_index=idx,
                )
            )

        task.status = "done"
        db.commit()
        logger.info(f"任务 {task.id} 对话生成完成，共 {len(lines)} 条")
    except Exception as e:
        task.status = "failed"
        db.commit()
        raise HTTPException(status_code=500, detail=str(e)) from e

    return GenerateResponse(task_id=task.id, message="对话生成成功")


class ScriptOut(BaseModel):
    """单条对话脚本输出。"""

    id: int
    role: str
    text: str
    order_index: int

    model_config = {"from_attributes": True}


@router.get("/{task_id}", response_model=list[ScriptOut])
def get_dialog(task_id: int, db: Session = Depends(get_db)) -> list[ScriptOut]:
    """获取指定任务的对话脚本列表。"""
    scripts = (
        db.query(DialogScript)
        .filter(DialogScript.task_id == task_id)
        .order_by(DialogScript.order_index)
        .all()
    )
    if not scripts:
        raise HTTPException(status_code=404, detail="任务不存在或尚无对话")
    return [ScriptOut.model_validate(s) for s in scripts]
