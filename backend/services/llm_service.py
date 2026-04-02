"""LLM 服务：封装大语言模型调用，支持多模型扩展。"""

from loguru import logger
from openai import AsyncOpenAI

from core.config import settings


class LLMService:
    """大语言模型调用服务，默认使用 OpenAI 兼容接口。

    支持扩展：通过修改 .env 中 LLM_MODEL / BASE_URL 切换模型，
    例如 deepseek-chat、qwen-max 等兼容 OpenAI 协议的模型。
    """

    def __init__(self) -> None:
        """初始化 OpenAI 异步客户端。"""
        self._client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.base_url,
        )
        logger.info(f"LLMService 初始化: model={settings.llm_model}, base_url={settings.base_url}")

    async def generate_dialog(self, prompt: str) -> str:
        """调用 LLM 生成对话文本。

        Args:
            prompt: 构建好的提示词字符串。

        Returns:
            LLM 返回的原始对话文本。

        Raises:
            RuntimeError: 当 API 调用失败时抛出。
        """
        logger.info(f"调用 LLM: model={settings.llm_model}, prompt_len={len(prompt)}")
        try:
            response = await self._client.chat.completions.create(
                model=settings.llm_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.8,
                max_tokens=2048,
            )
            text = response.choices[0].message.content or ""
            logger.info(f"LLM 返回: {len(text)} 字符")
            return text
        except Exception as e:
            logger.error(f"LLM 调用失败: {e}")
            raise RuntimeError(f"LLM 调用失败: {e}") from e


llm_service = LLMService()
