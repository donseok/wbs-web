#!/usr/bin/env bash
# 빈 TCP 포트 하나를 OS 에서 받아 stdout 에 번호만 한 줄로 낸다. 규칙 정본: ../references/e2e.md 「서버 프로세스」.
#
# E2E 서버는 빈 포트에 직접 띄운다. 번호를 눈으로 고르면 같은 PC 의 다른 팀원 서버와 부딪힌다(2026-09-26 성능 감사
# P8: 18100 이 이미 쓰이고 있었고, 18696 은 형제 워크트리의 프로세스가 쥐고 있었다). 포트 0 에 bind 하면 OS 가
# 지금 비어 있는 포트를 준다.
#
# 사용법
#   PORT=$(.claude/skills/dflow-dev/scripts/free-port.sh) || exit 1
#   ./gradlew :api:bootRun --no-daemon --args="--server.port=$PORT" > /tmp/api.log 2>&1 &
#
# 방법(앞에서 되는 것을 쓴다)
#   1) python3, 2) python — 모든 인터페이스의 포트 0 에 bind 해 받은 번호. Windows 의 python3 가 스토어 안내용 가짜 실행
#      파일이면 실패하거나 엉뚱한 글을 내므로, 출력이 1024~65535 의 숫자가 아니면 다음 방법으로 넘어간다.
#   3) 폴백 — 20000~59999 에서 무작위로 골라 lsof(없으면 nc)로 리슨 중인지 확인한다. 둘 다 없으면 확인 없이 그 번호를 낸다
#      (stderr 에 FREE_PORT_UNCHECKED 를 적는다).
# 받은 포트는 곧바로 닫으므로 서버가 bind 하기 전에 남이 가져갈 수 있다(드묾). 서버가 "Address already in use" 로 뜨지 못하면
# 이 스크립트를 다시 불러 새 포트로 띄운다.
#
# exit 0 = 포트를 냈다. exit 1 = 폴백까지 모두 실패(FREE_PORT_FAIL).
set -u

valid() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; [ "$1" -ge 1024 ] && [ "$1" -le 65535 ]; }

PY='import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.bind(("", 0))
print(s.getsockname()[1])
s.close()'

for py in python3 python; do
  command -v "$py" >/dev/null 2>&1 || continue
  p=$("$py" -c "$PY" 2>/dev/null | tr -d '\r' | head -n 1)
  if valid "$p"; then echo "$p"; exit 0; fi
done

# 폴백: 무작위 범위 + 리슨 확인
listening() { # $1 포트 — 리슨 중이면 0, 아니면 1, 확인할 도구가 없으면 2
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
    return $?
  fi
  return 2
}
i=0
while [ "$i" -lt 50 ]; do
  i=$((i + 1))
  p=$(( 20000 + (RANDOM * 32768 + RANDOM) % 40000 ))
  listening "$p"
  case $? in
    1) echo "$p"; exit 0 ;;
    2) echo "FREE_PORT_UNCHECKED $p — python·lsof·nc 가 없어 비어 있는지 확인하지 못했다" >&2; echo "$p"; exit 0 ;;
  esac
done
echo "FREE_PORT_FAIL 빈 포트를 찾지 못했다(50회)" >&2
exit 1
