#!/usr/bin/env bash
#
# atlas_run.sh — submit an "active task" to the Atlas Market API and poll it to
# completion.
#
# Every v0.2 endpoint requires a workspace API key. Create one in Atlas →
# Workspace settings → API Keys, then supply it either via the environment or an
# interactive prompt:
#
#     export API_KEY=...          # preferred — never touches the shell history
#     ./scripts/atlas_run.sh -i fba2855f-2e0a-485e-ac0c-193f99a58400
#
# The key is streamed to curl through a config file on stdin so it never appears
# in the process arguments (where any local user could read it via `ps`).
#
set -euo pipefail

API_URL_BASE=${ATLAS_API_URL_BASE:-https://api.prod-market.atlas.design}
API_VERSION=${ATLAS_API_VERSION:-0.2}
API_ID=${ATLAS_API_ID:-}
TASK_FILE=${ATLAS_TASK_FILE:-tasks/TASK-001.payload.json}
POLL_INTERVAL=${ATLAS_POLL_INTERVAL:-2}
TIMEOUT=${ATLAS_TIMEOUT:-600}
OUTPUT_FILE=${ATLAS_OUTPUT_FILE:-}
QUIET=${ATLAS_QUIET:-0}

usage() {
  cat <<'USAGE'
Usage: scripts/atlas_run.sh [options]

Options:
  -i, --api-id ID          Atlas API id to execute          (env: ATLAS_API_ID)
  -t, --task-file PATH     JSON file with the request body  (env: ATLAS_TASK_FILE)
  -b, --base-url URL       API base URL                     (env: ATLAS_API_URL_BASE)
  -v, --version VER        API version segment              (env: ATLAS_API_VERSION)
  -n, --poll-interval SEC  Seconds between status checks    (default: 2)
  -T, --timeout SEC        Give up after this long          (default: 600)
  -o, --output PATH        Also write the result JSON here
  -q, --quiet              Suppress progress output
  -h, --help               Show this help

Environment:
  API_KEY                  Atlas workspace API key. Prompted for if unset.
USAGE
}

log() {
  [[ "$QUIET" == "1" ]] || printf '%s\n' "$*" >&2
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--api-id)        API_ID=${2:?--api-id needs a value}; shift 2 ;;
    -t|--task-file)     TASK_FILE=${2:?--task-file needs a value}; shift 2 ;;
    -b|--base-url)      API_URL_BASE=${2:?--base-url needs a value}; shift 2 ;;
    -v|--version)       API_VERSION=${2:?--version needs a value}; shift 2 ;;
    -n|--poll-interval) POLL_INTERVAL=${2:?--poll-interval needs a value}; shift 2 ;;
    -T|--timeout)       TIMEOUT=${2:?--timeout needs a value}; shift 2 ;;
    -o|--output)        OUTPUT_FILE=${2:?--output needs a value}; shift 2 ;;
    -q|--quiet)         QUIET=1; shift ;;
    -h|--help)          usage; exit 0 ;;
    *)                  usage; die "unknown argument: $1" ;;
  esac
done

command -v curl >/dev/null || die "curl is required"
command -v jq   >/dev/null || die "jq is required (https://jqlang.github.io/jq/)"
[[ -n "$API_ID" ]] || die "no API id — pass --api-id or set ATLAS_API_ID"
[[ -f "$TASK_FILE" ]] || die "task file not found: $TASK_FILE"
jq -e . "$TASK_FILE" >/dev/null 2>&1 || die "task file is not valid JSON: $TASK_FILE"

# --- Authentication ----------------------------------------------------------
if [[ -z "${API_KEY:-}" ]]; then
  [[ -t 0 ]] || die "API_KEY is not set and stdin is not a terminal"
  read -rsp 'Atlas workspace API key: ' API_KEY
  printf '\n' >&2
fi
[[ -n "$API_KEY" ]] || die "API_KEY is empty"

# Stream the auth header through curl's config stdin so the key never lands in
# the process table.
atlas_curl() {
  printf 'header = "Authorization: Bearer %s"\n' "$API_KEY" \
    | curl --config - --silent --show-error "$@"
}

# --- 1. Submit ---------------------------------------------------------------
submit_url="$API_URL_BASE/$API_VERSION/api_execute_async/$API_ID"
log "Submitting $TASK_FILE to $submit_url"

submit_resp=$(atlas_curl --request POST \
  --header 'Content-Type: application/json' \
  --data "@$TASK_FILE" \
  "$submit_url") || die "submit request failed"

if printf '%s' "$submit_resp" | jq -e 'has("error")' >/dev/null 2>&1; then
  die "request failed: $(printf '%s' "$submit_resp" | jq -r '.error')"
fi

execution_id=$(printf '%s' "$submit_resp" | jq -r '.execution_id // empty')
[[ -n "$execution_id" && "$execution_id" != "null" ]] \
  || die "no execution_id in response: ${submit_resp:0:400}"

log "Submitted execution: $execution_id"

# --- 2. Poll -----------------------------------------------------------------
status_url="$API_URL_BASE/$API_VERSION/api_status/$execution_id"
deadline=$(( $(date +%s) + TIMEOUT ))

while true; do
  sleep "$POLL_INTERVAL"

  status_resp=$(atlas_curl --request GET "$status_url") \
    || die "status request failed for $execution_id"

  status=$(printf '%s' "$status_resp" | jq -r '.status // "unknown"')
  log "Status: $status"

  case "$status" in
    completed)
      result=$(printf '%s' "$status_resp" | jq '.result')
      if [[ -n "$OUTPUT_FILE" ]]; then
        printf '%s\n' "$result" > "$OUTPUT_FILE"
        log "Result written to $OUTPUT_FILE"
      fi
      printf '%s\n' "$result"
      exit 0
      ;;
    failed)
      error_msg=$(printf '%s' "$status_resp" | jq -r '.error.error // .error // "unknown error"')
      die "execution failed: $error_msg"
      ;;
    pending|running)
      ;;
    *)
      die "unknown status '$status' — full response: ${status_resp:0:400}"
      ;;
  esac

  if (( $(date +%s) >= deadline )); then
    die "timed out after ${TIMEOUT}s waiting for $execution_id (last status: $status)"
  fi
done
