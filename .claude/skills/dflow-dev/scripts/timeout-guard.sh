#!/bin/sh
# timeout-guard.sh — 긴 명령을 timeout 없이 부르지 못하게 막는 PreToolUse(Bash) 가드 훅.
# 설계: wbs-web 리포 docs/superpowers/specs/2026-09-26-dflow-perf-audit-kit-design.md(킷에는 미동봉) 「① 백그라운드 정지 방지」.
#
# 왜: Bash 도구는 timeout 을 주지 않으면 120초 뒤 명령을 백그라운드로 옮긴다. Phase 서브에이전트는 그 완료 알림을
# 받지 못한 채 턴을 끝내 팀원이 47분~1.5시간씩 멈췄다(dmes-standard 감사, 약 16건). 문서 규칙만으로는 막히지 않았다.
#
# 등록: 팀원 전용 설정(~/.dflow/limits/<id8>.settings.json, dflow-team/references/backends.md 「팀원 워크트리 준비」)의
# hooks.PreToolUse(matcher Bash). 전역 ~/.claude/settings.json 에는 넣지 않는다. 수동 세션은 kit/README.md 의 선택 사항.
#
# 입력(stdin): PreToolUse 훅 JSON — tool_name, tool_input.command, tool_input.timeout, tool_input.run_in_background.
# 판정(명령 위치에 오는 대상만 본다):
#   대상  heavy.sh(하위 명령 status·snapshot·release 만 제외 — 그 밖의 하위 명령·옵션은 모두 대상), baseline.sh run,
#         deps.sh(의존성 설치 + 준비 빌드), gradlew, mvn·mvnw, playwright test(npx·pnpm·pnpm exec·yarn 접두 포함).
#   명령 위치 = 줄 처음, 또는 ; && || | & ( ) ` 뒤, then·do·else·if·while·!·{ 와 VAR=값·nohup·env·time·exec 같은 접두 뒤,
#         sh·bash <스크립트> 의 스크립트, sh·bash -c '<문자열>' 의 문자열 안. heredoc 본문과 따옴표 안의 글자는 명령이 아니다.
#   1. E2E 서버 기동(그 조각이 gradlew …bootRun·mvn spring-boot:run)은 run_in_background: true 이거나 조각 끝이 & 면
#      통과한다. nohup 자체는 예외가 아니다 — nohup 뒤가 서버 기동 형태일 때만 통과한다(nohup ./gradlew test 는 거부).
#      java -jar·next dev·pnpm dev·npm run dev 는 애초에 대상이 아니므로 nohup 을 붙여도 통과한다.
#      `( cd api && ./gradlew bootRun ) &`·`{ ./gradlew bootRun > log 2>&1; } &` 처럼 ( )·{ } 로 묶어 띄워도 같다 —
#      묶음을 닫는 )·} 뒤(공백 건너뛰고) 첫 글자가 &(단 && 는 아님)면 그 묶음 안 조각들도 끝이 & 인 것으로 본다.
#      서버 기동이 아닌 명령을 묶어 띄운 것(`( ./gradlew test ) &`)은 여전히 거부한다(판정 2).
#   2. 대상을 run_in_background: true 로 부르면 거부한다.
#   3. 대상인데 timeout 이 없거나 300000 미만이면 거부한다.
#   거부 = stderr 에 이유 + exit 2(Claude Code 가 도구 호출을 막고 이유를 모델에게 보여 준다). 그 밖에는 exit 0.
# 편의 장치이지 보안 장치가 아니다: jq 가 없거나 입력을 못 읽으면 그대로 통과한다(fail-open). 변수에 담아 부르는
# 명령($H ./gradlew …)은 알아보지 못한다.

command -v jq >/dev/null 2>&1 || { cat >/dev/null 2>&1; exit 0; }
IN=$(cat 2>/dev/null) || exit 0
TOOL=$(printf '%s' "$IN" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
[ "$TOOL" = Bash ] || exit 0
CMD=$(printf '%s' "$IN" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$CMD" ] || exit 0
TO=$(printf '%s' "$IN" | jq -r '(.tool_input.timeout // 0) | if type == "number" then floor elif type == "string" then (tonumber? // 0 | floor) else 0 end' 2>/dev/null) || TO=0
case "$TO" in ''|*[!0-9]*) TO=0 ;; esac
BG=$(printf '%s' "$IN" | jq -r '.tool_input.run_in_background == true' 2>/dev/null) || BG=false

# 명령 문자열을 조각(단순 명령)으로 나눠 대상 조각마다 "<이름>\t<서버 기동 0|1>\t<끝이 & 0|1>" 한 줄을 낸다.
# 서버 기동 = gradlew·mvn 조각에 bootRun·spring-boot:run 인자가 있을 때뿐이다(nohup 접두는 따지지 않는다).
# macOS /usr/bin/awk(BWK)에서도 돌게 POSIX awk 만 쓴다. 작은따옴표는 \047 로 적는다.
PROG='
BEGIN {
  SQ = "\047"; DQ = "\""
  split("then do else elif if while until { } ! time nohup exec command builtin rtk proxy", a, " ")
  for (x in a) PFX[a[x]] = 1
}
{ s = s $0 "\n" }
END { scan(s, 0) }

function classify(W, nw, depth,    k, w, j, base, v, srv, cf) {
  k = 1; srv = 0
  while (k <= nw) {
    w = W[k]
    if (w ~ /^[A-Za-z_][A-Za-z0-9_]*=/) { k++; continue }
    if (w ~ /^[0-9]*&?[<>]/) { if (w ~ /^[0-9]*&?[<>]+[&|]?$/) k++; k++; continue }
    if (w in PFX) { k++; continue }
    if (w == "env" || w == "nice" || w == "sudo" || w == "timeout" || w == "gtimeout") {
      k++
      while (k <= nw && W[k] ~ /^-/) { if (W[k] ~ /^-[nuskC]$/) k++; k++ }
      if ((w == "timeout" || w == "gtimeout") && k <= nw) k++
      continue
    }
    if (w == "sh" || w == "bash" || w == "zsh" || w == "dash") {
      j = k + 1; cf = 0
      while (j <= nw && W[j] ~ /^-/) { if (W[j] ~ /^-[A-Za-z]*c/) cf = 1; j++ }
      if (cf) { if (j <= nw && depth < 3) scan(W[j], depth + 1); return "" }
      if (j <= nw) { k = j; continue }
      return ""
    }
    break
  }
  if (k > nw) return ""
  base = W[k]; sub(/.*\//, "", base)
  if (base == "heavy.sh") {
    j = k + 1
    while (j <= nw) {
      if (W[j] == "--pool") { j += 2; continue }
      if (W[j] ~ /^--pool=/) { j++; continue }
      break
    }
    v = (j <= nw) ? W[j] : ""
    if (v == "status" || v == "snapshot" || v == "release" || v == "") return ""
    return "heavy.sh " v "\t" srv
  }
  if (base == "baseline.sh") { if (k + 1 <= nw && W[k + 1] == "run") return "baseline.sh run\t" srv; return "" }
  if (base == "deps.sh") { return "deps.sh\t" srv }
  if (base == "gradlew" || base == "mvn" || base == "mvnw") {
    for (j = k + 1; j <= nw; j++) if (W[j] ~ /bootRun|spring-boot:run/) srv = 1
    return base "\t" srv
  }
  if (base == "npx" || base == "pnpm" || base == "pnpx" || base == "yarn" || base == "bunx") {
    j = k + 1
    while (j <= nw) {
      if (W[j] == "--filter" || W[j] == "-F" || W[j] == "-C" || W[j] == "--dir" || W[j] == "--cwd" || W[j] == "--package" || W[j] == "-p") { j += 2; continue }
      if (W[j] ~ /^-/ || W[j] == "exec" || W[j] == "dlx") { j++; continue }
      break
    }
    k = j - 1; base = (j <= nw) ? W[j] : ""
  }
  if (base == "playwright" && k + 2 <= nw && W[k + 2] == "test") return "playwright test\t" srv
  return ""
}

# 조각들의 amp 를 한 값으로 덮어써(bg) 한꺼번에 낸다. ( )·{ } 로 묶인 서버 기동은 묶음이 다 닫혀야
# 뒤의 & 를 알 수 있으므로(scan() 참고) 묶여 있는 동안 여기 버퍼에 쌓아 두다가 한 번에 낸다.
function flushGroup(bg, BUF, BAMP, bn,    bi) {
  for (bi = 1; bi <= bn; bi++) print BUF[bi] "\t" (bg ? 1 : BAMP[bi])
}

function scan(s, depth,    n, i, c, d, q, word, inw, nw, W, nh, hd, hs, h, delim, strip, e, line, amp,
              pdepth, bn, BUF, BAMP, res, bg, ii) {
  n = length(s); i = 1; q = ""; word = ""; inw = 0; nw = 0; nh = 0; pdepth = 0; bn = 0
  while (i <= n) {
    c = substr(s, i, 1)
    if (q == SQ) { if (c == SQ) q = ""; else word = word c; i++; continue }
    if (q == DQ) {
      if (c == "\\") { d = substr(s, i + 1, 1); if (d != "\n") word = word d; i += 2; continue }
      if (c == DQ) q = ""; else word = word c
      i++; continue
    }
    if (c == "\\") { d = substr(s, i + 1, 1); if (d != "\n") { word = word d; inw = 1 }; i += 2; continue }
    if (c == SQ || c == DQ) { q = c; inw = 1; i++; continue }
    if (c == " " || c == "\t") { if (inw) { W[++nw] = word; word = ""; inw = 0 }; i++; continue }
    if (c == "#" && !inw) { while (i <= n && substr(s, i, 1) != "\n") i++; continue }
    if (c == "<" && substr(s, i + 1, 1) == "<" && substr(s, i + 2, 1) != "<") {
      if (inw) { W[++nw] = word; word = ""; inw = 0 }
      i += 2; strip = 0
      if (substr(s, i, 1) == "-") { strip = 1; i++ }
      while (substr(s, i, 1) == " " || substr(s, i, 1) == "\t") i++
      delim = ""
      while (i <= n) {
        d = substr(s, i, 1)
        if (d == " " || d == "\t" || d == "\n" || d == ";" || d == "&" || d == "|" || d == "<" || d == ">" || d == "(" || d == ")") break
        if (d != SQ && d != DQ && d != "\\") delim = delim d
        i++
      }
      if (delim != "") { nh++; hd[nh] = delim; hs[nh] = strip }
      continue
    }
    if (c == "&" && substr(s, i + 1, 1) != "&" && ((inw && word ~ /[<>]$/) || substr(s, i + 1, 1) == ">")) { word = word c; inw = 1; i++; continue }
    if (c == "\n" || c == ";" || c == "&" || c == "|" || c == "(" || c == ")" || c == "`") {
      if (inw) { W[++nw] = word; word = ""; inw = 0 }
      amp = 0
      if (c == "&") { if (substr(s, i + 1, 1) == "&") i++; else amp = 1 }
      if (c == "|" && substr(s, i + 1, 1) == "|") i++
      if (nw > 0) {
        # `{ ...` 로 시작하는 조각은 중괄호 묶음에 들어간다 — `{` 는 문자 구분자가 아니라 공백으로 갈린 낱말이라
        # 뒤에 오는 실제 명령과 같은 조각으로 모인다(PFX 로 건너뛴다).
        if (W[1] == "{") pdepth++
        res = classify(W, nw, depth)
        if (res != "") {
          if (pdepth > 0) { bn++; BUF[bn] = res; BAMP[bn] = amp } else print res "\t" amp
        }
        # 홀로 `}` 뿐인 조각 = 중괄호 묶음이 닫혔다. `}` 뒤의 &(공백을 건너도)는 이 조각을 끝내는 바로 이
        # 구분자 이벤트에서 amp 로 이미 잡혀 있으므로(공백은 낱말만 끊지 조각을 끊지 않는다) 그대로 쓴다.
        if (nw == 1 && W[1] == "}" && pdepth > 0) {
          pdepth--
          if (pdepth == 0 && bn > 0) { flushGroup(amp, BUF, BAMP, bn); bn = 0 }
        }
      }
      nw = 0; i++
      if (c == "(") pdepth++
      if (c == ")") {
        if (pdepth > 0) pdepth--
        if (pdepth == 0 && bn > 0) {
          # `)` 자신은 결코 &가 아니라서(amp 는 늘 0) 그 뒤(공백 건너뛰고)를 따로 살펴야 한다 — `}` 와 달리
          # `(`·`)` 는 문자 구분자라 묶음 안 마지막 조각과 그 뒤의 & 가 서로 다른 이벤트로 나뉜다.
          bg = 0; ii = i
          while (substr(s, ii, 1) == " " || substr(s, ii, 1) == "\t") ii++
          if (substr(s, ii, 1) == "&" && substr(s, ii + 1, 1) != "&") bg = 1
          flushGroup(bg, BUF, BAMP, bn); bn = 0
        }
      }
      if (c == "\n" && nh > 0) {
        for (h = 1; h <= nh; h++) {
          while (i <= n) {
            e = index(substr(s, i), "\n")
            if (e == 0) { line = substr(s, i); i = n + 1 } else { line = substr(s, i, e - 1); i += e }
            if (hs[h]) sub(/^\t+/, "", line)
            if (line == hd[h]) break
          }
        }
        nh = 0
      }
      continue
    }
    word = word c; inw = 1; i++
  }
  if (inw) W[++nw] = word
  if (nw > 0) {
    if (W[1] == "{") pdepth++
    res = classify(W, nw, depth)
    if (res != "") {
      if (pdepth > 0) { bn++; BUF[bn] = res; BAMP[bn] = 0 } else print res "\t0"
    }
    if (nw == 1 && W[1] == "}" && pdepth > 0) {
      pdepth--
      if (pdepth == 0 && bn > 0) { flushGroup(0, BUF, BAMP, bn); bn = 0 }
    }
  }
  # 끝까지 닫히지 않은 묶음(비정상 입력)이 있으면 잃어버리지 않게 배경 아님(0)으로 낸다 — fail-open.
  if (bn > 0) flushGroup(0, BUF, BAMP, bn)
}
'

HITS=$(printf '%s\n' "$CMD" | awk "$PROG" 2>/dev/null) || exit 0
[ -n "$HITS" ] || exit 0

TAB=$(printf '\t')
RETRY="10분을 넘을 명령은 \`heavy.sh --detach <명령>\` 으로 띄운 뒤 \`heavy.sh wait <id>\` 를 끝날 때까지 반복 호출한다."
printf '%s\n' "$HITS" | {
  while IFS="$TAB" read -r label srv amp; do
    [ -n "$label" ] || continue
    if [ "$srv" = 1 ] && { [ "$BG" = true ] || [ "$amp" = 1 ]; }; then continue; fi
    if [ "$BG" = true ]; then
      echo "timeout-guard: \`$label\` 를 run_in_background 로 부르지 않는다. 백그라운드 명령은 끝나도 서브에이전트가 완료 알림을 받지 못해 그대로 멈춘다. run_in_background 없이 Bash 의 timeout 을 300000~600000 으로 주고 다시 호출하라. $RETRY" >&2
      exit 2
    fi
    [ "$TO" -ge 300000 ] && continue
    if [ "$TO" -gt 0 ]; then now="timeout $TO"; else now="timeout 없음"; fi
    hint=""
    [ "$srv" = 1 ] && hint=" E2E 서버를 띄우는 명령이면 run_in_background: true 로 부른다."
    echo "timeout-guard: \`$label\` 는 오래 걸리는 명령이다(지금 $now). timeout 을 300000~600000 으로 주고 다시 호출하라. timeout 이 짧거나 없으면 120초 뒤 백그라운드로 옮겨지고 서브에이전트는 완료 알림을 받지 못한 채 멈춘다. $RETRY$hint" >&2
    exit 2
  done
  exit 0
}
