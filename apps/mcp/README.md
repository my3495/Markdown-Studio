---
type: project
---
# @md-studio/mcp

Markdown Studio 的 MCP 服务器：把本地 Markdown 知识库暴露给 Cursor / Claude Desktop 等客户端。

## 安装

```bash
npm i -g @md-studio/mcp
# 或无需全局安装
npx -y @md-studio/mcp --workspace ~/Notes
```

## 运行

```bash
# stdio（默认，供 MCP 客户端拉起）
md-studio-mcp --workspace ~/Notes

# HTTP MCP（本机集成 / 桌面 sidecar）
md-studio-mcp --http --workspace ~/Notes --port 3721 --token secret

# REST（Alfred / Raycast / n8n）
md-studio-mcp --rest --workspace ~/Notes --port 3722 --token secret
# GET /notes  GET /search?q=  GET /notes/:id  POST /notes（需 --allow-write）

# 多库联邦
md-studio-mcp --workspace ~/Notes --workspace ~/Work
```

## 一键接入客户端

```bash
# 打印配置 JSON
md-studio-mcp config --workspace ~/Notes --npx

# 写入 Cursor (~/.cursor/mcp.json)
md-studio-mcp install --workspace ~/Notes --client cursor --npx

# 写入 Claude Desktop
md-studio-mcp install --workspace ~/Notes --client claude --npx
```

可选 `--allow-write` 开放写库工具。

## 工具

`list_notes` / `read_note` / `search` / `get_outline` / `get_backlinks` / `get_outgoing`；写工具需 `--allow-write`。

```tldraw
{"v":1,"strokes":[{"color":"#e5484d","width":4,"points":[{"x":317.0731506347656,"y":182.36932373046875}],"id":"smvpyiixh-5"}],"shapes":[]}
```

