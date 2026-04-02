"""音频生成 API 控制器。"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from models.audio_file import AudioFile
from models.dialog_script import DialogScript
from services.audio_merger import audio_merger
from services.tts_service import tts_service

router = APIRouter(prefix="/audio", tags=["audio"])


class ScriptInfo(BaseModel):
    """音频对应的脚本信息。"""

    id: int
    role: str
    text: str
    order_index: int

    model_config = {"from_attributes": True}


class AudioOut(BaseModel):
    """音频文件输出结构。"""

    id: int
    script_id: int
    file_path: str
    duration: float | None
    script: ScriptInfo | None = None

    model_config = {"from_attributes": True}


@router.post("/generate/{task_id}")
async def generate_audio(task_id: int, db: Session = Depends(get_db)) -> dict:
    """为指定任务的所有对话脚本生成音频。"""
    scripts = (
        db.query(DialogScript)
        .filter(DialogScript.task_id == task_id)
        .order_by(DialogScript.order_index)
        .all()
    )
    if not scripts:
        raise HTTPException(status_code=404, detail="任务不存在或无对话脚本")

    generated = 0
    for script in scripts:
        # 已有音频则跳过
        if db.query(AudioFile).filter(AudioFile.script_id == script.id).first():
            continue
        try:
            path, duration = await tts_service.generate_for_script(
                task_id, script.order_index, script.role, script.text
            )
            db.add(AudioFile(script_id=script.id, file_path=str(path), duration=duration))
            generated += 1
        except Exception as e:
            logger.error(f"脚本 {script.id} TTS 失败: {e}")
            raise HTTPException(status_code=500, detail=str(e)) from e

    db.commit()
    return {"task_id": task_id, "generated": generated, "message": "音频生成完成"}


@router.get("/list/{task_id}", response_model=list[AudioOut])
def list_audio(task_id: int, db: Session = Depends(get_db)) -> list[AudioOut]:
    """获取指定任务的音频文件列表（含脚本信息）。"""
    scripts = (
        db.query(DialogScript)
        .filter(DialogScript.task_id == task_id)
        .order_by(DialogScript.order_index)
        .all()
    )
    result: list[AudioOut] = []
    for s in scripts:
        if s.audio_file:
            out = AudioOut(
                id=s.audio_file.id,
                script_id=s.audio_file.script_id,
                file_path=s.audio_file.file_path,
                duration=s.audio_file.duration,
                script=ScriptInfo.model_validate(s),
            )
            result.append(out)
    return result


@router.get("/merge/{task_id}")
def merge_audio(task_id: int, db: Session = Depends(get_db)) -> FileResponse:
    """合并指定任务的所有音频并返回文件。"""
    scripts = (
        db.query(DialogScript)
        .filter(DialogScript.task_id == task_id)
        .order_by(DialogScript.order_index)
        .all()
    )
    paths: list[Path] = []
    for s in scripts:
        if s.audio_file:
            paths.append(Path(s.audio_file.file_path))

    if not paths:
        raise HTTPException(status_code=404, detail="无可合并的音频文件")

    try:
        merged = audio_merger.merge(task_id, paths)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    return FileResponse(str(merged), media_type="audio/wav", filename=merged.name)
