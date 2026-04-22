"""LLM 服务：封装大语言模型调用，支持多模型扩展。"""

from core.logger import logger

from core.config import settings

try:
    from openai import AsyncOpenAI
except ImportError:  # 兼容旧版 openai SDK（如 0.28.x）
    AsyncOpenAI = None
    import openai
else:
    openai = None


class LLMService:
    """大语言模型调用服务，默认使用 OpenAI 兼容接口。

    支持扩展：通过修改 .env 中 LLM_MODEL / BASE_URL 切换模型，
    例如 deepseek-chat、qwen-max 等兼容 OpenAI 协议的模型。
    """

    def __init__(self) -> None:
        """初始化 OpenAI 客户端。"""
        self._client = self._build_client()
        logger.info(f"LLMService 初始化: model={settings.llm_model}, base_url={settings.base_url}")

    def _build_client(self):
        """按当前 SDK 版本创建客户端。"""
        if AsyncOpenAI is not None:
            return AsyncOpenAI(
                api_key=settings.openai_api_key,
                base_url=settings.base_url,
            )

        openai.api_key = settings.openai_api_key
        openai.api_base = settings.base_url
        return openai

    def refresh_client(self) -> None:
        """配置变更后重建客户端。"""
        self._client = self._build_client()

    async def generate_dialog(self, prompt: str) -> str:
        """调用 LLM 生成对话文本。

        Args:
            prompt: 构建好的提示词字符串。

        Returns:
            LLM 返回的原始对话文本。

        Raises:
            RuntimeError: 当 API 调用失败时抛出。
        """
        request_payload = {
            "model": settings.llm_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.8,
            "max_tokens": 2048,
        }
        logger.info(
            f"调用 LLM: model={settings.llm_model}, prompt_len={len(prompt)}, request={request_payload}"
        )
        try:
            if AsyncOpenAI is not None:
                response = await self._client.chat.completions.create(**request_payload)
                text = response.choices[0].message.content or ""
                response_payload = response.model_dump()
            else:
                response = await self._client.ChatCompletion.acreate(**request_payload)
                text = response["choices"][0]["message"].get("content", "") or ""
                response_payload = response
            logger.info(
                f"LLM 返回: text_len={len(text)}, response={response_payload}"
            )
            return text
        except Exception as e:
            logger.error(f"LLM 调用失败: request={request_payload}, error={e}")
            raise RuntimeError(f"LLM 调用失败: {e}") from e


llm_service = LLMService()
