"""音频合并服务：使用 pydub 将多段 WAV 合并为单文件。"""

from pathlib import Path

from loguru import logger
from pydub import AudioSegment

from core.config import settings

_SILENCE_MS = 300


class AudioMerger:
    """将多段 WAV 按顺序合并，段间插入 300ms 静音。"""

    def __init__(self) -> None:
        """确保输出目录存在。"""
        settings.audio_path.mkdir(parents=True, exist_ok=True)

    def merge(self, task_id: int, file_paths: list[Path]) -> Path:
        """合并音频文件列表。

        Args:
            task_id: 任务 ID，用于命名输出文件。
            file_paths: 按顺序排列的 WAV 文件路径。

        Returns:
            合并后输出文件的 Path。

        Raises:
            ValueError: file_paths 为空时。
            RuntimeError: 合并过程出错时。
        """
        if not file_paths:
            raise ValueError("file_paths 不能为空")

        silence = AudioSegment.silent(duration=_SILENCE_MS)
        combined = AudioSegment.empty()

        try:
            for i, fp in enumerate(file_paths):
                seg = AudioSegment.from_wav(str(fp))
                if i > 0:
                    combined += silence
                combined += seg
        except Exception as e:
            logger.error(f"合并音频失败: {e}")
            raise RuntimeError(f"合并音频失败: {e}") from e

        output = settings.audio_path / f"merged_task_{task_id}.wav"
        combined.export(str(output), format="wav")
        logger.info(f"音频合并完成: {output}, 总时长={len(combined)/1000:.2f}s")
        return output


audio_merger = AudioMerger()
