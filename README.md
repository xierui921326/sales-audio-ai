# Sales Audio AI

Sales Audio AI 是一个用于生成销售对话脚本、批量生成语音并导出桌面安装包的项目。

当前项目由两部分组成：

- `backend`：基于 FastAPI 的后端服务，负责生成销售对话、保存配置、生成和合并音频
- `desktop`：基于 Tauri 2 + React + Vite 的桌面应用，负责图形界面与桌面端打包

## 项目能力

- 根据行业、销售场景、客户角色、语气、轮数生成销售对话
- 将多轮对话保存到数据库中
- 为每条对话生成语音
- 合并任务下的音频文件并导出
- 提供桌面端开发模式与安装包构建能力
- 提供 GitHub Actions 自动打包发布流程

## 项目目录

```text
sales-audio-ai/
├── backend/                 # FastAPI 后端
├── desktop/                 # Tauri + React 桌面端
├── .github/workflows/       # GitHub Actions 工作流
├── Makefile                 # 常用开发与打包命令
└── README.md                # 项目说明
```

## 环境要求

建议使用以下环境：

- Python 3.10+
- Node.js 20+ 或 24
- pnpm
- Rust stable
- macOS / Windows（桌面打包时按目标平台准备对应依赖）

如果你需要构建 Tauri 桌面应用，请先确保本机已经安装好 Rust 和 Tauri 所需的系统依赖。

## 快速开始

### 1. 初始化项目

在项目根目录执行：

```bash
make init
```

这个命令会完成：

- 初始化后端 `.env`
- 安装后端 Python 依赖
- 安装桌面端前端依赖

### 2. 配置后端环境变量

后端环境变量模板位于：

- `backend/.env.example`

当前包含以下字段：

```env
OPENAI_API_KEY=
LLM_MODEL=gpt-4o
BASE_URL=https://api.openai.com/v1
```

说明如下：

- `OPENAI_API_KEY`：大模型接口密钥
- `LLM_MODEL`：默认使用的模型名称
- `BASE_URL`：模型服务基础地址

### 3. 启动开发环境

在项目根目录执行：

```bash
make dev
```

该命令会同时启动：

- 后端服务：`http://127.0.0.1:8173`
- 桌面端 Tauri 开发模式

如果你只想单独启动某一部分，可以使用下面命令。

## 常用命令

### 后端

```bash
make backend-install
make backend-env
make backend-dev
make backend-start
make backend-db-clean
```

说明：

- `make backend-install`：安装后端依赖
- `make backend-env`：从模板生成 `.env`
- `make backend-dev`：热重载启动后端
- `make backend-start`：生产模式启动后端
- `make backend-db-clean`：清空本地数据库

### 桌面端

```bash
make desktop-install
make desktop-dev
make desktop-build
make desktop-build-windows
make desktop-build-macos-intel
make desktop-build-macos-arm
make desktop-build-macos
make desktop-build-all-installers
```

说明：

- `make desktop-install`：安装桌面端依赖
- `make desktop-dev`：启动 Tauri 开发模式
- `make desktop-build`：构建当前机器平台的安装包
- `make desktop-build-windows`：构建 Windows 安装包
- `make desktop-build-macos-intel`：构建 Intel Mac 安装包
- `make desktop-build-macos-arm`：构建 Apple Silicon 安装包
- `make desktop-build-macos`：连续构建 Intel 与 Apple Silicon 安装包
- `make desktop-build-all-installers`：构建全部安装包

### 其他

```bash
make clean
make help
```

## 后端接口说明

后端入口文件：

- `backend/main.py`

健康检查接口：

- `GET /health`

返回示例：

```json
{
  "status": "ok"
}
```

### 1. 生成销售对话

- **接口**：`POST /dialog/generate`
- **用途**：生成多轮销售对话并入库

请求体：

```json
{
  "industry": "教育培训",
  "scene": "电话邀约",
  "customer_role": "家长",
  "tone": "专业",
  "rounds": 8
}
```

字段说明：

- `industry`：行业名称
- `scene`：销售场景
- `customer_role`：客户角色
- `tone`：对话语气，默认 `专业`
- `rounds`：对话轮数，范围 `1-30`

返回示例：

```json
{
  "task_id": 1,
  "message": "对话生成成功"
}
```

### 2. 查询某个任务的对话脚本

- **接口**：`GET /dialog/{task_id}`
- **用途**：获取指定任务下的对话列表

返回示例：

```json
[
  {
    "id": 1,
    "role": "sales",
    "text": "您好，我这边是...",
    "order_index": 0
  }
]
```

### 3. 生成任务音频

- **接口**：`POST /audio/generate/{task_id}`
- **用途**：为指定任务的所有对话生成音频

返回示例：

```json
{
  "task_id": 1,
  "generated": 8,
  "message": "音频生成完成"
}
```

### 4. 查询音频列表

- **接口**：`GET /audio/list/{task_id}`
- **用途**：获取指定任务已经生成的音频文件列表

### 5. 合并音频

- **接口**：`GET /audio/merge/{task_id}`
- **用途**：将任务下所有音频合并为一个 wav 文件并直接下载

### 6. 获取当前配置

- **接口**：`GET /config`
- **用途**：读取当前运行时配置

### 7. 更新配置

- **接口**：`POST /config`
- **用途**：更新 LLM、TTS 与存储配置，并持久化保存

请求结构包含：

- `llm.provider`
- `llm.model`
- `llm.api_key`
- `llm.base_url`
- `tts.provider`
- `tts.voices.sales`
- `tts.voices.customer`
- `storage.storage_dir`

## 桌面端说明

桌面端使用：

- Tauri 2
- React 19
- Vite 5

桌面端目录：

- `desktop/`

Tauri 配置文件：

- `desktop/src-tauri/tauri.conf.json`

当前产品标识：

- `productName`: `Sales Audio AI`
- `identifier`: `com.xier.sales-audio-ai`

## GitHub Actions 打包说明

工作流文件：

- `.github/workflows/desktop-package.yml`

当前工作流能力：

- 构建 Windows 安装包
- 构建 macOS Intel 安装包
- 构建 macOS Apple Silicon 安装包
- 上传构建产物
- 在 tag 发布时创建 GitHub Release

### 已处理的 GitHub Actions Node 24 兼容项

当前 workflow 已升级并适配 Node 24：

- `pnpm/action-setup@v6`
- `actions/upload-artifact@v6`
- `actions/download-artifact@v8`
- `softprops/action-gh-release@v3`

并且已启用：

```yaml
FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
```

## macOS 打包与“文件损坏”问题说明

如果你在 M 芯片 Mac 上看到“文件损坏”，通常不是安装包真的坏了，而是下面这些原因之一：

- 应用没有签名
- 应用签名不完整
- 应用没有 notarization（公证）
- Gatekeeper 拦截了来自互联网的未可信应用

### 当前 workflow 已做的修复

- 当配置了 Apple 证书时，Tauri 会尝试执行正式签名
- 当没有配置 Apple 证书时，workflow 会为 macOS 构建启用 ad-hoc 签名
- CI 中新增了 `codesign` 校验
- 当 Apple 公证凭据存在时，CI 中会执行 `spctl` 校验

### 推荐配置的 GitHub Secrets

如果你要正式发布 macOS 安装包，建议在 GitHub Secrets 中配置：

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

或者使用 App Store Connect API：

- `APPLE_API_KEY`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY_PATH`

### 不配置 Apple 证书时会怎样

如果没有配置 Apple 证书，当前流程会退化为 ad-hoc 签名。这能改善 Apple Silicon 上完全未签名应用的问题，但仍然可能需要用户在系统“隐私与安全性”中手动允许打开。

## 发布建议

如果你要正式给用户分发 macOS 安装包，建议按这个顺序做：

1. 配置 Apple Developer 证书
2. 配置 notarization 所需 Secrets
3. 推送 `v*` 标签触发 GitHub Actions
4. 检查 workflow 中的 `codesign` 和 `spctl` 日志
5. 再把 Release 产物发给用户

## 适合先做的下一步

如果你接下来还要继续完善这个项目，我建议优先做下面几件事：

- 补充桌面端页面操作说明
- 为后端接口补充请求失败示例和错误码说明
- 增加 GitHub Actions 构建完成后的产物校验说明
- 增加本地 macOS 安装包验签排查文档
