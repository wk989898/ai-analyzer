# ai-analyzer

AI Agent CLI 使用分析工具，支持 token 统计、对话总结、用户品味画像（taste.md）和本地 Web 可视化。

## 安装

```bash
cd ai-analyzer
npm install
npm run build
npm link   # 全局安装 ai-analyzer 命令
```

## 使用

```bash
# 分析今天的使用情况
ai-analyzer run

# 分析指定日期
ai-analyzer run --date 2026-03-26

# 启动 Web 可视化界面
ai-analyzer serve
# 打开 http://localhost:3000

# 守护进程模式（每天 23:00 自动运行）
ai-analyzer daemon start
ai-analyzer daemon stop

# 查看 taste 画像
ai-analyzer taste
ai-analyzer taste --history

# 修改配置
ai-analyzer config outputDir ~/my-ai-usage
ai-analyzer config scheduleCron "0 22 * * *"
```

## 配置

配置文件：`~/.ai-analyzer/config.json`

| 字段 | 默认值 | 说明 |
|------|--------|------|
| outputDir | ~/ai-usage | 报告输出目录 |
| steeringDir | ~/.kiro/steering | Kiro steering 目录 |
| tasteDir | ~/ai-usage/taste | taste 版本存储目录 |
| scheduleCron | 0 23 * * * | 定时表达式 |
| webPort | 3000 | Web 服务端口 |

## API Keys（环境变量）

```bash
export AI_ANALYZER_KEY_OPENAI=sk-...
export AI_ANALYZER_KEY_KIRO=...
```

## 输出文件

- `~/ai-usage/YYYY-MM-DD.md` — 每日报告
- `~/ai-usage/usage-summary.md` — 汇总报告
- `~/ai-usage/taste/taste-vN.md` — taste 历史版本
- `~/.kiro/steering/taste.md` — 注入 Kiro 的用户画像

## 支持的工具

- Kiro CLI
- OpenAI Codex CLI
- Claude CLI（适配器待完善）
- Gemini CLI（适配器待完善）

新增工具：在 `src/parser/adapters/` 添加新的 Adapter 类并实现 `LogAdapter` 接口。
