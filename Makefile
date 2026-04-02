# ============================================================
# Sales Audio AI - 项目管理命令
# ============================================================

# 默认目标：显示帮助
.DEFAULT_GOAL := help

BACKEND_DIR := backend
DESKTOP_DIR := desktop
PYTHON      := python3
UVICORN     := uvicorn

# -----------------------------------------------------------
# 帮助
# -----------------------------------------------------------
.PHONY: help
help: ## 显示所有可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# -----------------------------------------------------------
# 后端 - 环境
# -----------------------------------------------------------
.PHONY: backend-install
backend-install: ## 安装后端 Python 依赖
	cd $(BACKEND_DIR) && pip install -r requirements.txt

.PHONY: backend-env
backend-env: ## 从 .env.example 初始化 .env 配置文件
	@if [ ! -f $(BACKEND_DIR)/.env ]; then \
		cp $(BACKEND_DIR)/.env.example $(BACKEND_DIR)/.env; \
		echo "已创建 $(BACKEND_DIR)/.env，请填写 OPENAI_API_KEY"; \
	else \
		echo "$(BACKEND_DIR)/.env 已存在，跳过"; \
	fi

# -----------------------------------------------------------
# 后端 - 运行
# -----------------------------------------------------------
.PHONY: backend-dev
backend-dev: ## 启动后端开发服务器（热重载）
	cd $(BACKEND_DIR) && $(UVICORN) main:app --reload --host 0.0.0.0 --port 8173

.PHONY: backend-start
backend-start: ## 启动后端生产服务器
	cd $(BACKEND_DIR) && $(UVICORN) main:app --host 0.0.0.0 --port 8173

# -----------------------------------------------------------
# 后端 - 数据库
# -----------------------------------------------------------
.PHONY: backend-db-clean
backend-db-clean: ## 删除本地 SQLite 数据库（谨慎操作）
	rm -f $(BACKEND_DIR)/storage/app.db
	echo "数据库已清除"

# -----------------------------------------------------------
# 前端 - 环境
# -----------------------------------------------------------
.PHONY: desktop-install
desktop-install: ## 安装前端依赖（pnpm）
	cd $(DESKTOP_DIR) && pnpm install

# -----------------------------------------------------------
# 前端 - 开发
# -----------------------------------------------------------
.PHONY: desktop-dev
desktop-dev: ## 启动 Tauri 桌面端开发模式
	cd $(DESKTOP_DIR) && pnpm tauri dev

.PHONY: desktop-build
desktop-build: ## 构建 Tauri 桌面端安装包
	cd $(DESKTOP_DIR) && pnpm tauri build

# -----------------------------------------------------------
# 一键启动（后端 + 前端并行，仅开发环境）
# -----------------------------------------------------------
.PHONY: dev
dev: ## 同时启动后端和桌面端开发服务器（退出时清理后端进程）
	trap '$(MAKE) dev-stop' INT TERM EXIT; \
	$(MAKE) backend-dev & \
	BACK_PID=$$!; \
	$(MAKE) desktop-dev; \
	$(MAKE) dev-stop

.PHONY: dev-stop
dev-stop: ## 停止开发服务器：杀掉 uvicorn 并释放 8173 端口
	- pkill -f "uvicorn main:app --reload" 2>/dev/null || true
	- lsof -ti tcp:8173 | xargs -I {} kill -9 {} 2>/dev/null || true
	@echo "已停止 backend-dev 并清理端口占用"

# -----------------------------------------------------------
# 清理
# -----------------------------------------------------------
.PHONY: clean
clean: ## 清理构建产物与缓存
	rm -rf $(DESKTOP_DIR)/dist
	rm -rf $(DESKTOP_DIR)/node_modules/.cache
	rm -rf $(DESKTOP_DIR)/src-tauri/target
	find $(BACKEND_DIR) -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; true
	find $(BACKEND_DIR) -name '*.pyc' -delete 2>/dev/null; true
	echo "清理完成"

# -----------------------------------------------------------
# 初始化（新环境一键准备）
# -----------------------------------------------------------
.PHONY: init
init: backend-env backend-install desktop-install ## 初始化整个项目（环境变量 + 安装依赖）
	echo "项目初始化完成，运行 make dev 启动"
