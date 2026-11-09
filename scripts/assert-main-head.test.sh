#!/usr/bin/env bash
# Checks scripts/assert-main-head.sh against a fake git that answers `ls-remote` with a chosen head.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin="$(mktemp -d)"
trap 'rm -rf "$bin"' EXIT
failures=0

# The fake git prints FAKE_MAIN_HEAD as the ls-remote result; empty means no head was returned.
cat >"$bin/git" <<'FAKE'
#!/usr/bin/env bash
if [[ ${1:-} == ls-remote ]]; then
  [[ -n ${FAKE_MAIN_HEAD:-} ]] && printf '%s\trefs/heads/main\n' "$FAKE_MAIN_HEAD"
  exit 0
fi
exit 1
FAKE
chmod +x "$bin/git"

# run_case <name> <head> <sha> <expect: pass|fail>
run_case() {
  local name=$1 head=$2 sha=$3 expect=$4 status=0
  PATH="$bin:$PATH" FAKE_MAIN_HEAD="$head" "$here/assert-main-head.sh" "$sha" >/dev/null 2>&1 || status=$?
  if [[ $expect == pass && $status -ne 0 ]] || [[ $expect == fail && $status -eq 0 ]]; then
    echo "FAIL $name (exit $status, expected $expect)"
    failures=$((failures + 1))
  else
    echo "PASS $name"
  fi
}

run_case "head sha is deployable" aaa111 aaa111 pass
run_case "older sha is refused" aaa111 bbb222 fail
run_case "unreachable remote is refused" "" aaa111 fail

((failures == 0)) || { echo "$failures case(s) failed"; exit 1; }
echo "all assert-main-head tests passed"
