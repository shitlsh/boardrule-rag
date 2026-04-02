# Evaluation and acceptance

## Gstone / 长规则书验收（Phase 1）

1. 将 **1–2 本**页数明显超过「短规则舒适区」的规则书 PDF 放入 `eval/fixtures/`（文件名自定）。**不要**将大 PDF 提交到 git；目录已忽略 `*.pdf`。
2. 常见来源：集石、出版方官网、BoardGameGeek 文件区等；任选复杂、多表、多例外的规则书更能压测管线。
3. 启动 rule engine，设置 `LANGCHAIN_TRACING_V2=true` 与 LangSmith 相关变量，便于对照 Run 名称（节点如 `toc_analyzer`、`chapter_extract`）。
4. 对每本 PDF 调用 `POST /extract`，轮询 `GET /extract/{job_id}` 至 `completed`。
5. 用 `eval/check_extraction_output.py` 检查合并后的 Markdown（或从响应中保存为文件再检查）：

```bash
cd services/rule_engine
source .venv/bin/activate
python eval/check_extraction_output.py path/to/merged.md --min-words 3000 --min-page-markers 5
```

6. **验收关注点**
   - **字数**：合并规则正文足够长（阈值按游戏自定，`--min-words` 可调整）。
   - **页码**：输出中含足够数量的 `<!-- pages: ... -->` 锚点（`--min-page-markers`）。
   - **LangSmith**：同一 `LANGCHAIN_PROJECT` 下可见完整图运行；节点名清晰便于回归。

## Phase 2 索引烟测

在拿到 `merged_markdown` 后，用 JSON 客户端发送正文（避免在 shell 里内嵌整本规则转义）。示例使用临时文件：

```bash
python - <<'PY'
import json, urllib.request
body = {
  "game_id": "eval-game-1",
  "merged_markdown": open("merged.md", encoding="utf-8").read(),
  "source_file": "rules.pdf",
}
req = urllib.request.Request(
  "http://127.0.0.1:8000/build-index",
  data=json.dumps(body).encode("utf-8"),
  headers={"Content-Type": "application/json"},
)
print(urllib.request.urlopen(req).read().decode())
PY
```

成功时响应含 `manifest`（`metadata_contract`、`node_count`、`embedding_model` 等）。

```bash
curl -s "http://127.0.0.1:8000/index/eval-game-1/smoke-retrieve?q=%E5%9B%9E%E5%90%88"
```

响应中的 `metadata` 应含 `pages`、`source_file`、`game_id` 等字段。
