# 规则抽取验收样例（回归与定性对比）

用于人工验收 **boardrule-rag** 抽取管线相对 **Dify 单步 Gemini Pro** 的还原度；自动化单测见 `tests/test_extraction_routing.py` 等。

## 样例矩阵

| 类型 | 代表输入 | 关注点 |
|------|----------|--------|
| 薄规则书 | 集石类单页或少量页说明（例：[doc-246](https://www.gstonegames.com/game/doc-246.html) 所代表的一类） | 默认应走 **简单路径**（`extraction_profile: simple`）、正文 **单批 vision**、合并改写少；配件表与术语不丢 |
| 中等篇幅 | 约 10–40 页正文 | 分流与分批合理；页码锚点 `<!-- pages: ... -->` 可用 |
| 厚册 | 多章、目录需分批 | **强制全量流程** 与默认复杂路径；`NEED_MORE_CONTEXT` 与 merge 行为可接受 |

## 与 Dify 单步 Pro 的并排对比（定性）

在 Dify-boardgame-rule-agent（或等价工作流）中对 **同一 PDF/图集** 跑一次 **单节点 Pro 全文理解**，与引擎结果并排检查：

1. **完整性**：流程阶段、计分、例外条款是否被删改或过度概括。
2. **基础块**：配件清单行项、术语/关键词、setup 是否齐全。
3. **可追溯**：HTML 页码注释是否与原文页一致（未编造）。
4. **风格**：是否出现明显「合并精修」导致的术语漂移或结构乱序。

## API 与 UI 开关

- `POST /extract` 表单字段 **`force_full_pipeline`**：为 true 时跳过「薄册简单路径」门闸，始终进入复杂路径启发式（仍受正文页数、`effective` 等影响）；用于对比或厚册排错。
- 轮询 `GET /extract/{job_id}` 返回 **`complexity`**、**`extraction_profile`**（`simple` | `complex`）、**`toc`**，便于在 Web 或日志中确认当前路径。
