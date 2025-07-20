<div align="center">

# GeminiCli2API 🚀

**一个将 Google Gemini CLI 封装为本地 API 的强大代理，并提供 OpenAI 兼容接口。**

</div>

<div align="center">

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-≥18.0.0-green.svg)](https://nodejs.org/)

[**中文**](./README.md) | [**English**](./README-EN.md)

</div>

> `GeminiCli2API` 包含两个独立的 Node.js HTTP 服务器，它们作为 Google Cloud Code Assist API 的本地代理。其中一个服务器更是提供了与 OpenAI API 完全兼容的接口。这让您可以摆脱终端界面的束缚，将 Gemini 的强大能力以 API 的形式轻松接入到任何您喜爱的客户端或应用中。

---

## 📝 项目概述

本项目由三个核心文件构成，各司其职：

*   `gemini-api-server.js`: 💎 **原生 Gemini 代理服务**
    *   一个独立的 Node.js HTTP 服务器，作为 Google Cloud Code Assist API 的本地代理。
    *   它提供了所有核心功能和错误修复，设计稳健、灵活，并配备了全面可控的日志系统，方便监控和调试。

*   `openai-api-server.js`: 🔄 **OpenAI 兼容代理服务**
    *   基于 `gemini-api-server.js` 构建，同样作为 Google API 的代理。
    *   关键在于，它对外暴露了与 OpenAI API 兼容的接口。这意味着任何支持 OpenAI API 的客户端都无需修改代码，即可无缝切换使用。

*   `gemini-core.js`: ⚙️ **核心共享逻辑**
    *   这是两个服务器共享的心脏，包含了认证、API 调用、请求/响应处理以及日志记录等核心功能。

---

## 💡 核心优势

*   ✅ **突破官方限制**：解决了 Gemini 官方免费 API 额度紧张的问题。通过本项目，您可以使用 Gemini CLI 的账号授权，享受更高的每日请求限额。
*   ✅ **无缝兼容 OpenAI**：提供了与 OpenAI API 完全兼容的接口，让您现有的工具链和客户端（如 LobeChat, NextChat 等）可以零成本接入 Gemini。
*   ✅ **增强的可控性**：通过强大的日志功能，可以捕获并记录所有请求的提示词（Prompts），便于审计、调试和构建私有数据集。
*   ✅ **易于扩展**：代码结构清晰，方便您进行二次开发，实现如统一前置提示词、响应缓存、内容过滤等自定义功能。

### ⚠️ 目前的局限

*   暂未实现原版 Gemini CLI 的部分内置命令功能。
*   多模态能力（如图片输入）尚在开发计划中 (TODO)。

---

## 🛠️ 主要功能

### 💎 Gemini API Server (`gemini-api-server.js`)

*   🔐 **自动认证与令牌续期**: 首次运行将引导您通过浏览器完成 Google 账号授权。获取的 OAuth 令牌会安全存储在本地，并在过期前自动刷新，确保服务不间断。
*   🔗 **简化的手动授权流程**:
    1.  **复制授权链接**：终端会输出一个 Google 授权 URL。
    2.  **浏览器授权**：在任何图形界面设备的浏览器中打开该 URL，登录并授予权限。
    3.  **粘贴重定向URL**：授权后，浏览器会尝试重定向到一个 `localhost` 地址，回终端即可完成认证。
    > 凭证文件将存储于：
    > *   **Windows**: `C:\Users\USERNAME\.gemini\oauth_creds.json`
    > *   **macOS/Linux**: `~/.gemini/oauth_creds.json`
*   🔑 **灵活的 API 密钥校验**: 支持通过 URL 查询参数 (`?key=...`) 或 `x-goog-api-key` 请求头提供 API 密钥。
*   🔧 **角色规范化修复**: 自动为请求体添加必要的 'user'/'model' 角色，并正确处理 `systemInstruction`。
*   🤖 **固定的模型列表**: 默认提供并使用 `gemini-1.5-pro-latest` 和 `gemini-1.5-flash-latest` 模型。
*   🌐 **完整的 Gemini API 端点支持**: 完整实现了 `listModels`, `generateContent`, 和 `streamGenerateContent`。
*   📜 **全面可控的日志系统**: 可将带时间戳的提示词日志输出到控制台或文件，并显示令牌剩余有效期。

### 🔄 OpenAI 兼容 API Server (`openai-api-server.js`)

*   🌍 **OpenAI API 兼容性**: 完美实现了 `/v1/models` 和 `/v1/chat/completions` 核心端点。
*   🔄 **自动格式转换**: 在内部自动将 OpenAI 格式的请求/响应与 Gemini 格式进行无缝转换。
*   💨 **流式传输支持**: 完全支持 OpenAI 的流式响应 (`"stream": true`)，提供打字机般的实时体验。
*   🛡️ **多样的认证方式**: 支持 `Authorization: Bearer <key>`, URL 查询参数 (`?key=...`) 和 `x-goog-api-key` 请求头进行 API 密钥校验。
*   ⚙️ **高度可配置**: 可通过命令行参数灵活配置监听地址、端口、API 密钥和日志模式。
*   ♻️ **重用核心逻辑**: 底层与 Gemini API Server 共享 `gemini-core.js`，保证了稳定性与一致性。

---

## 📦 安装指南

1.  **环境准备**:
    *   请确保您已安装 [Node.js](https://nodejs.org/) (建议版本 >= 18.0.0)。
    *   本项目已包含 `package.json` 并设置 `{"type": "module"}`，您无需手动创建。

2.  **安装依赖**:
    克隆本仓库后，在项目根目录下执行：
    ```bash
    npm install
    ```
    这将自动安装 `google-auth-library` 和 `uuid` 等必要依赖。

---

## 🚀 快速开始

### 1. Gemini API Server (`gemini-api-server.js`)

#### ▶️ 启动服务
*   **默认启动** (监听 `localhost:3000`)
    ```bash
    node gemini-api-server.js
    ```
*   **监听所有网络接口** (用于 Docker 或局域网访问)
    ```bash
    node gemini-api-server.js 0.0.0.0
    ```
*   **打印提示词到控制台**
    ```bash
    node gemini-api-server.js --log-prompts console
    ```
*   **组合参数** (指定 IP、端口、API Key 并记录日志到文件)
    ```bash
    node gemini-api-server.js 0.0.0.0 --port 3001 --api-key your_secret_key --log-prompts file
    ```
*   **通过 base64 编码的凭证启动** (例如，用于 Docker 或 CI/CD 环境)
    ```bash
    node gemini-api-server.js --oauth-creds-base64 "YOUR_BASE64_ENCODED_OAUTH_CREDS_JSON"
    ```
*   **通过指定凭证文件路径启动** (例如，用于自定义凭证位置)
    ```bash
    node gemini-api-server.js --oauth-creds-file "/path/to/your/oauth_creds.json"
    ```

#### 💻 调用 API (默认 API Key: `123456`)
*   **列出模型**
    ```bash
    curl "http://localhost:3000/v1beta/models?key=123456"
    ```
*   **生成内容 (带系统提示)**
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-pro:generateContent" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: 123456" \
      -d '{
        "system_instruction": { "parts": [{ "text": "你是一只名叫 Neko 的猫。" }] },
        "contents": [{ "parts": [{ "text": "你好，你叫什么名字？" }] }]
      }'
    ```
*   **流式生成内容**
    ```bash
    curl "http://localhost:3000/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=123456" \
      -H "Content-Type: application/json" \
      -d '{"contents":[{"parts":[{"text":"写一首关于宇宙的五行短诗"}]}]}'
    ```

### 2. OpenAI 兼容 API Server (`openai-api-server.js`)

#### ▶️ 启动服务
*启动参数与 `gemini-api-server.js` 完全一致。*

*   **示例** (监听 `localhost:8000`, API Key 为 `sk-your-key`)
    ```bash
    node openai-api-server.js --port 8000 --api-key sk-your-key
    ```

#### 💻 调用 API (以 OpenAI 客户端方式)
*   **列出模型**
    ```bash
    curl http://localhost:8000/v1/models \
      -H "Authorization: Bearer sk-your-key"
    ```
*   **生成内容 (非流式)**
    ```bash
    curl http://localhost:8000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer sk-your-key" \
      -d '{
        "model": "gemini-2.5-pro",
        "messages": [
          {"role": "system", "content": "你是一只名叫 Neko 的猫。"},
          {"role": "user", "content": "你好，你叫什么名字？"}
        ]
      }'
    ```
*   **流式生成内容**
    ```bash
    curl http://localhost:8000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer sk-your-key" \
      -d '{
        "model": "gemini-2.5-flash",
        "messages": [
          {"role": "user", "content": "写一首关于宇宙的五行短诗"}
        ],
        "stream": true
      }'
    ```

---

## 🌟 特殊用法与进阶技巧

*   **🔌 对接任意 OpenAI 客户端**: 这是本项目的杀手级功能。通过 `openai-api-server.js`，将任何支持 OpenAI 的应用（如 LobeChat, NextChat, VS Code 插件等）的 API 地址指向本服务，即可无缝使用 Gemini。

*   **🔍 中心化请求监控与审计**: 使用 `--log-prompts` 参数捕获所有客户端发送的系统提示词和用户请求。这对于分析、调试和优化提示词，甚至构建私有数据集都至关重要。

*   **🛠️ 作为二次开发基石**:
    *   **统一系统提示**: 修改 `gemini-core.js`，为所有请求强制添加一个统一的、不可见的系统提示词，确保 AI 回复遵循特定角色或格式。
    *   **响应缓存**: 对高频重复问题添加缓存逻辑，降低 API 调用，提升响应速度。
    *   **自定义内容过滤**: 在请求发送或返回前增加关键词过滤或内容审查逻辑，满足合规要求。

---

## 📄 开源许可

本项目遵循 [**GNU General Public License v3 (GPLv3)**](https://www.gnu.org/licenses/gpl-3.0) 开源许可。详情请查看根目录下的 `LICENSE` 文件。

## 🙏 致谢

本项目的开发受到了官方 Google Gemini CLI 的极大启发，并参考了Cline 3.18.0 版本 `gemini-cli.ts` 的部分代码实现。在此对 Google 官方团队和 Cline 开发团队的卓越工作表示衷心的感谢！
