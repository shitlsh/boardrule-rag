#!/usr/bin/env bash
# =============================================================================
# 将 .env.example 的结构同步到 .env：新增变量、保留注释与空行布局；
# 已存在于 .env 的键保留当前值（不覆盖本地密钥）。
#
# 用法：
#   ./scripts/env-sync.sh              # 默认同步 apps/web
#   ./scripts/env-sync.sh apps/web
#   ./scripts/env-sync.sh services/rule_engine
#   ./scripts/env-sync.sh --all        # 依次同步上述两处（若存在 .env.example）
#   ./scripts/env-sync.sh --help
#
# 兼容 macOS 默认 Bash 3.2（不使用关联数组）。思路参考 Dify：
# https://github.com/langgenius/dify/blob/main/docker/dify-env-sync.sh
# =============================================================================

set -euo pipefail

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
log_err() { echo -e "${RED}[ERR]${NC} $*" >&2; }

# 从 file 中取第一个 KEY= 整行（KEY 仅 [A-Za-z0-9_]；值可含 =）
get_env_line_for_key() {
  local key="$1"
  local file="$2"
  grep "^${key}=" "$file" 2>/dev/null | head -1 || true
}

sync_one_dir() {
  local dir="${1%/}"
  local example="$dir/.env.example"
  local target="$dir/.env"
  local backup_dir="$dir/env-backup"

  if [[ ! -f "$example" ]]; then
    log_err "缺少文件: $example"
    return 1
  fi

  if [[ ! -f "$target" ]]; then
    log_warn "不存在 $target，从 .env.example 复制"
    cp "$example" "$target"
    log_ok "已创建 $target"
    return 0
  fi

  mkdir -p "$backup_dir"
  local ts
  ts=$(date +"%Y%m%d_%H%M%S")
  local backup_file="$backup_dir/.env.backup_$ts"
  cp "$target" "$backup_file"
  log_ok "已备份: $backup_file"

  local tmp
  local preserved=0
  local updated=0
  tmp=$(mktemp)
  local line key existing

  while IFS= read -r line || [[ -n "${line:-}" ]]; do
    if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "${line// /}" ]]; then
      printf '%s\n' "$line" >>"$tmp"
      continue
    fi
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      existing=$(get_env_line_for_key "$key" "$target")
      if [[ -n "$existing" ]]; then
        printf '%s\n' "$existing" >>"$tmp"
        preserved=$((preserved + 1))
      else
        printf '%s\n' "$line" >>"$tmp"
        updated=$((updated + 1))
      fi
    else
      printf '%s\n' "$line" >>"$tmp"
    fi
  done <"$example"

  mv "$tmp" "$target"
  # 避免在 Bash 3.2 下全角括号/标点与 $var 相邻导致解析错误（触发 set -u 的 unbound variable）
  log_ok "已写入 ${target} (preserved keys: ${preserved}, new keys from example: ${updated})"

  local ex_keys cur_keys orphaned=""
  ex_keys=$(mktemp)
  cur_keys=$(mktemp)
  awk -F= '!/^[[:space:]]*#/ && /^[A-Za-z_][A-Za-z0-9_]*=/ { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1); print $1 }' "$example" | sort -u >"$ex_keys"
  awk -F= '!/^[[:space:]]*#/ && /^[A-Za-z_][A-Za-z0-9_]*=/ { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1); print $1 }' "$target" | sort -u >"$cur_keys"
  orphaned=$(comm -13 "$ex_keys" "$cur_keys" || true)
  rm -f "$ex_keys" "$cur_keys"
  if [[ -n "${orphaned}" ]]; then
    log_warn "以下键仅存在于 .env，已不在 .env.example 中（未自动删除）："
    while IFS= read -r k; do
      [[ -n "$k" ]] && log_warn "  - $k"
    done <<<"$orphaned"
  fi
}

main() {
  case "${1:-}" in
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --all)
      local ec=0
      for d in apps/web services/rule_engine; do
        if [[ -f "$d/.env.example" ]]; then
          log_info "=== 同步 $d ==="
          sync_one_dir "$d" || ec=1
          echo ""
        fi
      done
      exit "$ec"
      ;;
    "")
      sync_one_dir "apps/web"
      ;;
    *)
      sync_one_dir "$1"
      ;;
  esac
}

main "$@"
