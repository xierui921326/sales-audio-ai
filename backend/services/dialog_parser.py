"""对话解析服务：将 LLM 返回的原始文本解析为结构化列表。"""

import re
from typing import TypedDict

from loguru import logger


class DialogLine(TypedDict):
    """单条对话行结构。"""

    role: str
    text: str


_ROLE_MAP: dict[str, str] = {
    "销售": "sales",
    "客户": "customer",
}

_LINE_PATTERN = re.compile(r"^(销售|客户)[：:]\s*(.+)$")


def parse_dialog(raw_text: str) -> list[DialogLine]:
    """解析 LLM 返回的对话文本为结构化列表。

    Args:
        raw_text: LLM 原始输出，每行格式为 "销售：xxx" 或 "客户：xxx"。

    Returns:
        有序的 DialogLine 列表，role 为 "sales" 或 "customer"。
    """
    result: list[DialogLine] = []
    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue
        match = _LINE_PATTERN.match(line)
        if match:
            role = _ROLE_MAP.get(match.group(1), match.group(1))
            result.append(DialogLine(role=role, text=match.group(2).strip()))
        else:
            logger.warning(f"跳过无法解析的行: {line!r}")
    logger.info(f"对话解析完成，共 {len(result)} 条")
    return result
