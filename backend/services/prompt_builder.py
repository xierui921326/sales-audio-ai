"""Prompt 构建服务：根据销售场景参数生成 LLM 提示词。"""


def build_dialog_prompt(
    industry: str,
    scene: str,
    customer_role: str,
    tone: str,
    rounds: int,
) -> str:
    """构建多轮销售对话生成 Prompt。

    Args:
        industry: 行业名称，例如 SaaS、保险、教育。
        scene: 销售场景，例如 demo邀约、续费沟通。
        customer_role: 客户角色，例如 老板、IT负责人。
        tone: 对话语气，例如 专业、亲切、简洁。
        rounds: 期望对话轮数（每轮含销售+客户各一句）。

    Returns:
        完整的 Prompt 字符串。
    """
    return (
        f"你是一位经验丰富的{industry}行业销售顾问。\n"
        f"请模拟一段真实的销售对话，场景为【{scene}】，客户角色为【{customer_role}】。\n"
        f"对话语气要求：{tone}。\n"
        f"请生成 {rounds} 轮对话（每轮包含销售和客户各一句话）。\n\n"
        "输出格式要求（严格遵守）：\n"
        "销售：<内容>\n"
        "客户：<内容>\n"
        "销售：<内容>\n"
        "客户：<内容>\n"
        "……\n\n"
        "注意事项：\n"
        "1. 每句话不超过 30 字\n"
        "2. 语言口语化，贴近真实销售场景\n"
        "3. 只输出对话内容，不要添加序号、标题或其他说明\n"
        "4. 严格交替输出：销售 → 客户 → 销售 → 客户\n"
    )
