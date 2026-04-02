"""TTS 服务：使用 edge-tts 将文本转换为 WAV 音频文件。"""

import wave
from pathlib import Path

import edge_tts
from loguru import logger

from core.config import settings

VOICE_MAP: dict[str, str] = {
    "sales": "zh-CN-YunxiNeural",
    "customer": "zh-CN-XiaoyiNeural",
}


class TTSService:
    """基于 edge-tts 的文本转语音服务，支持多角色声音。"""

    def __init__(self) -> None:
        """初始化并确保音频目录存在。"""
        self._audio_dir = settings.audio_path
        self._audio_dir.mkdir(parents=True, exist_ok=True)

    def _file_path(self, task_id: int, index: int, role: str) -> Path:
        """按命名规则构建音频文件路径。"""
        return self._audio_dir / f"task_{task_id}_{index}_{role}.wav"

    async def generate_for_script(
        self, task_id: int, index: int, role: str, text: str
    ) -> tuple[Path, float]:
        """为单条对话脚本生成音频。

        Args:
            task_id: 任务 ID。
            index: 对话行序号。
            role: 角色名称（"sales" 或 "customer"）。
            text: 对话文本内容。

        Returns:
            (音频文件 Path, 时长秒数) 元组。
        """
        voice = VOICE_MAP.get(role, VOICE_MAP["sales"])
        output_path = self._file_path(task_id, index, role)
        logger.info(f"TTS: voice={voice}, text={text[:20]!r}")
        try:
            comm = edge_tts.Communicate(text=text, voice=voice)
            await comm.save(str(output_path))
        except Exception as e:
            logger.error(f"TTS 失败: {e}")
            raise RuntimeError(f"TTS 失败: {e}") from e
        duration = _wav_duration(output_path)
        return output_path, duration


def _wav_duration(path: Path) -> float:
    """读取 WAV 文件时长（秒），失败返回 0.0。"""
    try:
        with wave.open(str(path), "rb") as wf:
            return wf.getnframes() / float(wf.getframerate())
    except Exception:
        return 0.0


tts_service = TTSService()
