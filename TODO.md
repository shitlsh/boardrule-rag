# Outstanding Issues

Findings from a full-project review. Issues are grouped by sub-project and
priority. Items marked **DONE** have already been addressed.

---

## services/rule_engine

### HIGH

- **`api/routers/chat.py:113–118`** — `t_build_begin` may be referenced before
  assignment in certain exception paths (uninitialized variable bug).
  **DONE**: initialized to `t0` before the `try` block.
- **`graphs/nodes/chapter_extract.py:101–112`** — Lambda inside a loop captures
  loop variables `i` and `parts` by reference. Currently safe because the loop
  finishes before lambdas are called, but fragile; use default-argument binding
  (`lambda i=i, parts=parts: ...`) to make intent explicit.
- **No per-request correlation ID** — concurrent log lines cannot be correlated
  to a specific request. Add a `request_id` / `trace_id` to every log record
  (e.g. via middleware + `contextvars`).

### MEDIUM

- **`api/routers/chat.py:155`** — `chat_engine._condense_question()` is a
  LlamaIndex private API (leading underscore). It may disappear without notice
  on a minor LlamaIndex upgrade. Pin to a tested LlamaIndex version or avoid
  calling private methods.
- **`api/routers/chat.py:299`** — Worker-thread `join(timeout=600)` has no
  cancellation path; a hung upstream call blocks a thread slot for 10 minutes.
  Consider `concurrent.futures` with `Future.cancel()` or a dedicated timeout
  mechanism.
- **`api/routers/extract.py:377`** — Bare `assert` is stripped by Python `-O`
  (optimized bytecode). Replace with an explicit `if … raise` guard.
  **DONE**: replaced with `if file is None: raise RuntimeError(...)`.
- **`api/routers/extract.py:222–226`** — `r.content` loads the entire PDF into
  memory at once. Use `r.iter_content()` / stream to a temp file for large PDFs.
- **`api/routers/extract.py:488–500`** — Two separate lock acquisitions on the
  resume path leave a TOCTOU window between the check and the update. Combine
  into a single critical section.
- **`api/main.py:127–129`** — Header parsing failure is silently swallowed with
  no log entry. Log at `WARNING` so ops can detect misconfigured clients.
  **DONE**: added `logger.warning(...)` with the exception message.
- **`utils/prompt_context.py:43–44`** — A fresh Jinja2 `Environment` is
  constructed on every `render_prompt()` call, discarding the template cache.
  Build the `Environment` once at module level (or use `functools.lru_cache`).
  **DONE**: `_JINJA_ENV` module-level singleton; `_env()` helper removed.
- **Three in-memory job stores** (`_jobs` dicts) — all job state is lost on
  process restart and no TTL eviction exists. For production use, persist to
  Redis/DB and add an expiry policy.

---

## miniapp (WeChat mini-program)

### HIGH

- **`pages/chat/index.vue:214`** — `@ts-nocheck` suppresses TypeScript across
  the entire 1 068-line script block. Remove the directive and fix individual
  type errors so the compiler can catch regressions.
- **`utils/auth.ts:122–128`** — Stored JWT tokens are never checked against
  their `exp` claim; a token remains valid in-app even after server-side
  expiry. Validate `exp` on every use (or on app resume) and force re-login
  when expired.
- **WeChat SSE `error` event `throw` not caught** — In the WeChat code path
  `throw` inside an `error` handler is not awaited, so the assistant bubble
  never leaves the loading state when the stream errors. Wrap in a try/catch
  or use a callback pattern compatible with the WeChat runtime.

### MEDIUM

- **`pages/chat/index.vue:261–267`** — `visibleSuggestions` is a `computed`
  property that calls `Math.random()`, making it non-deterministic. Move
  random selection to a method called on explicit user action instead.
- **`utils/auth.ts:122–163`** — `getOrFetchUserId` is not guarded against
  concurrent calls; multiple inflight `wx.login` requests can race. Protect
  with a promise singleton or a mutex flag.
- **`pages/chat/index.vue`** — 1 068-line single-file component. Extract chat
  message handling, SSE streaming, and suggestion logic into separate
  composables / sub-components to improve testability and maintainability.

---

## web (Next.js front-end)

### HIGH

- **`/api/h5-auth`** — No rate limiting on the H5 auth endpoint; open to
  brute-force / enumeration. Add IP-based rate limiting (e.g. `next-rate-limit`
  or an upstream WAF rule).
- **CORS wildcard fallback** — Overly permissive `Access-Control-Allow-Origin:
  *` in error/fallback paths allows cross-origin credential leakage. Restrict
  to an explicit origin allowlist.
- **500 responses expose raw exception messages** — Internal error details leak
  to the client in HTTP 500 bodies. Sanitize error responses; log the full
  exception server-side only.

### MEDIUM

- **`lib/ai-crypto.ts`** — Key derivation uses SHA-256, which is fast and
  therefore weak against offline brute-force. Replace with `scrypt` or PBKDF2
  (both available in the WebCrypto API) with an appropriate cost factor.

---

## Already Done (for reference)

- **DONE** `utils/retry.py` — Rewritten with `tenacity`; exponential back-off
  + jitter + rate-limit retry factory (`make_rate_limit_retry`).
- **DONE** `openrouter_client.py` / `dashscope_client.py` — Unified return type
  to `(str, bool)` (content, is_truncated).
- **DONE** `utils/providers/` — New `LlmProvider` Protocol + `GeminiProvider` +
  `OpenAICompatProvider`; single dispatch point in `llm_generate.py`.
- **DONE** `utils/llm_generate.py` — Reduced from 1 126 to ~555 lines.
- **DONE** `ingestion/index_builder.py` — `build_embedding_model()` factory
  replaces global `Settings.embed_model` writes; `configure_embedding_settings`
  kept as a deprecated backward-compat alias.
- **DONE** `ingestion/index_builder.py` + `ingestion/rulebook_query.py` —
  `load_vector_index()`, `build_and_persist_index()`, and
  `load_hybrid_reranked_nodes()` now accept an explicit `embed_model` argument;
  `build_rulebook_query_engine()` no longer writes `Settings.llm`.
- **DONE** `api/routers/chat.py` — `t_build_begin` initialized before `try` block.
- **DONE** `api/routers/extract.py` — Bare `assert file is not None` replaced
  with `if file is None: raise RuntimeError(...)`.
- **DONE** `api/main.py` — Header parse failure now logs at `WARNING`.
- **DONE** `utils/prompt_context.py` — Module-level `_JINJA_ENV` singleton;
  per-call `Environment()` construction eliminated.

## Investigated, not fixable / deferred

- **`ingestion/rulebook_query.py` Bedrock `api_key` mode** — The `os.environ`
  mutation for `AWS_BEARER_TOKEN_BEDROCK` is intentional: `BedrockConverse`
  (LlamaIndex) does not expose a constructor parameter for Bearer-token auth;
  boto3 reads the env var during session creation. The save/restore try/finally
  pattern is the only supported approach without patching the library.
