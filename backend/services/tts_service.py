"""TTS 服务：使用 edge-tts 将文本转换为音频文件。"""

import contextlib
import wave
from pathlib import Path

import edge_tts
from loguru import logger
from pydub import AudioSegment

from core.config import settings

VOICE_MAP: dict[str, str] = {
    "sales": settings.tts_voice_sales,
    "customer": settings.tts_voice_customer,
}


class TTSService:
    """基于 edge-tts 的文本转语音服务，支持多角色声音。"""

    def __init__(self) -> None:
        """初始化并确保音频目录存在。"""
        self._audio_dir = settings.audio_path
        self._audio_dir.mkdir(parents=True, exist_ok=True)

    def _file_path(self, task_id: int, index: int, role: str) -> Path:
        """按命名规则构建音频文件路径。"""
        return self._audio_dir / f"task_{task_id}_{index}_{role}.mp3"

    async def generate_for_script(
        self, task_id: int, index: int, role: str, text: str
    ) -> tuple[Path, float]:
        """为单条对话脚本生成音频。"""
        voice = VOICE_MAP.get(role, VOICE_MAP["sales"])
        output_path = self._file_path(task_id, index, role)
        logger.info(f"TTS: voice={voice}, text={text[:20]!r}")
        try:
            comm = edge_tts.Communicate(text=text, voice=voice)
            await comm.save(str(output_path))
        except Exception as e:
            logger.error(f"TTS 失败: {e}")
            raise RuntimeError(f"TTS 失败: {e}") from e
        duration = _audio_duration(output_path)
        return output_path, duration


def _audio_duration(path: Path) -> float:
    """读取音频文件时长（秒），失败返回 0.0。"""
    try:
        if path.suffix.lower() == ".wav":
            with contextlib.closing(wave.open(str(path), "rb")) as wf:
                return wf.getnframes() / float(wf.getframerate())
        return len(AudioSegment.from_file(str(path))) / 1000.0
    except Exception:
        return 0.0


tts_service = TTSService()


# 运行时配置更新后，直接复用同一个服务实例，只需要同步目录即可。
def refresh_audio_dir() -> None:
    tts_service._audio_dir = settings.audio_path
    tts_service._audio_dir.mkdir(parents=True, exist_ok=True)
