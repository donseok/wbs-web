#!/bin/sh
# 공용 결정 기록(decisions.md)의 머지 처리 — /dflow-merge 가 머지 자리에서 부른다(SKILL.md 「결정 번호 매김」).
#
# 배경: 대상 리포의 decisions.md 는 `## D-NNN (<UTC 타임스탬프>)` 블록을 추가만 하는 결정 감사 기록이고,
# dflow-wbs 의 decision-log.py validate 가 D-001 부터 끊김 없는 순번을 요구한다. 병렬 워커가 같은 기점에서 같은
# 다음 번호를 고르면 머지마다 충돌했다(2026-09-24 dmes-standard TSK-01-02·TSK-02-03). 그래서 agent 브랜치는
# Task 범위 임시 ID `D-<TSK>-<n>`(예 D-TSK-02-02-1)를 쓰고(dev-discipline 「공용 결정 기록(decisions.md)의 번호」),
# 전역 번호는 머지 때 이 스크립트가 매긴다. decision-log.py 의 형식·validate 규칙은 바꾸지 않는다.
#
# 사용:
#   decisions.sh merge-conflicts [-C <dir>]
#     머지 도중(충돌로 멈춘 상태) 충돌한 decisions.md 만 기계적으로 푼다: 결과 = 우리 쪽(개발 브랜치) 전체 +
#     그 쪽(머지 대상)이 merge-base 에 없던 블록을 그 순서대로 뒤에. 푼 파일은 stage 한다. 다른 충돌은 건드리지 않는다.
#     출력: DECISIONS_RESOLVED <경로> · DECISIONS_LEFT <경로> <사유>(그대로 둔 것). 늘 exit 0(사용 오류 2).
#   decisions.sh renumber [-C <dir>] [--tsk <TSK>] [--order <주문 UUID>]
#     트리 전체에서 임시 ID 머리(`## D-TSK-…-<n> …`)를 그 파일의 다음 전역 번호로 바꾸고(바로 아래 `- **Temp ID**: <임시 ID>`
#     줄을 남긴다), 추적 파일 전체의 같은 임시 ID 참조를 치환해 커밋 하나로 남긴다. 이미 번호가 매겨진 임시 ID(그 Temp ID
#     줄)의 남은 참조도 치환한다(스택 후손이 선행의 임시 ID 를 적어 둔 경우).
#     출력: RENUMBERED <임시 ID>=<D-NNN> <파일> … · REFS <파일 수> · COMMITTED <sha>(exit 0) · NO_TEMP_IDS(exit 0, 아무것도 안 함)
#           RENUMBER_DUP <임시 ID>(경고. 그 ID 만 건너뛴다) · UNION_SET <파일>(경고. merge=union 은 블록을 섞는다)
#           RENUMBER_DIRTY(exit 1, 트리가 깨끗하지 않음) · RENUMBER_FAILED <단계>(exit 1) · usage(exit 2)
set -u

die_usage() { echo "usage: decisions.sh merge-conflicts|renumber [-C <dir>] [--tsk <TSK>] [--order <UUID>]" >&2; exit 2; }
[ $# -ge 1 ] || die_usage
cmd=$1; shift
dir=.; tsk=; order=
while [ $# -gt 0 ]; do
  case "$1" in
    -C) [ $# -ge 2 ] || die_usage; dir=$2; shift 2 ;;
    --tsk) [ $# -ge 2 ] || die_usage; tsk=$2; shift 2 ;;
    --order) [ $# -ge 2 ] || die_usage; order=$2; shift 2 ;;
    *) die_usage ;;
  esac
done
ERR=RENUMBER_FAILED; [ "$cmd" = merge-conflicts ] && ERR=DECISIONS_FAILED
cd "$dir" 2>/dev/null || { echo "$ERR cd $dir"; exit 1; }
top=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "$ERR not-a-repo"; exit 1; }
cd "$top" || exit 1
tmp=$(mktemp -d 2>/dev/null || mktemp -d -t dflowdec) || { echo "$ERR mktemp"; exit 1; }
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

is_decisions() { case "$1" in decisions.md|*/decisions.md) return 0 ;; esac; return 1; }
TEMP_RE='D-TSK(-[0-9]+)+'

# ---------------------------------------------------------------------------------------------------------------
if [ "$cmd" = merge-conflicts ]; then
  git diff --name-only --diff-filter=U > "$tmp/u" 2>/dev/null || { echo "$ERR diff"; exit 1; }
  while IFS= read -r p; do
    is_decisions "$p" || continue
    st=$(git ls-files -u -- "$p" | awk '{print $3}' | sort -u | tr -d '\n')
    case "$st" in
      123) git show ":1:$p" > "$tmp/base" 2>/dev/null || { echo "DECISIONS_LEFT $p read-base"; continue; } ;;
      23) : > "$tmp/base" ;;   # 양쪽이 새로 만든 파일(add/add)
      *) echo "DECISIONS_LEFT $p stages=$st"; continue ;;   # 삭제/수정 충돌 등
    esac
    git show ":2:$p" > "$tmp/ours" 2>/dev/null && git show ":3:$p" > "$tmp/theirs" 2>/dev/null \
      || { echo "DECISIONS_LEFT $p read-stage"; continue; }
    # 블록 = `## ` 머리 줄부터 다음 `## ` 앞까지(끝 빈 줄 제외). 그 쪽 블록 가운데 merge-base 에 없던 머리만 뒤에 붙인다.
    # merge-base 에 있던 블록을 그 쪽이 고쳤으면(추가만 하는 기록의 위반) 기계적으로 풀지 않는다.
    # 어느 파일인지는 FILENAME 으로 가른다(merge-base 가 빈 파일이면 그 파일의 FNR==1 이 오지 않는다).
    awk -v OUT="$tmp/merged" -v FLAG="$tmp/flag" -v B="$tmp/base" -v O="$tmp/ours" '
      function flush() {
        if (cur == "") return
        sub(/\n+$/, "", body)
        if (which == 1) { bb[cur] = body }
        else if (which == 2) { ob[cur] = 1 }
        else { tn++; th[tn] = cur; tb[tn] = body }
        cur = ""; body = ""
      }
      FNR == 1 { flush(); which = (FILENAME == B ? 1 : (FILENAME == O ? 2 : 3)) }
      /^## / { flush(); cur = $0; body = $0; next }
      { if (cur != "") body = body "\n" $0 }
      END {
        flush()
        for (i = 1; i <= tn; i++) {
          h = th[i]
          if (h in bb) { if (bb[h] != tb[i]) { print "edited" > FLAG; exit } ; continue }
          if (h in ob) continue
          add = add "\n" tb[i] "\n"
        }
        printf "%s", add > OUT
      }' "$tmp/base" "$tmp/ours" "$tmp/theirs"
    if [ -s "$tmp/flag" ]; then echo "DECISIONS_LEFT $p edited-existing-block"; rm -f "$tmp/flag"; continue; fi
    [ -f "$tmp/merged" ] || : > "$tmp/merged"
    # 우리 쪽 끝이 줄바꿈이 아니면 하나 붙인 뒤 새 블록을 잇는다
    { cat "$tmp/ours"; [ -z "$(tail -c 1 "$tmp/ours")" ] || printf '\n'; cat "$tmp/merged"; } > "$p" \
      && git add -- "$p" && echo "DECISIONS_RESOLVED $p" || echo "DECISIONS_LEFT $p write"
    rm -f "$tmp/merged"
  done < "$tmp/u"
  exit 0
fi

[ "$cmd" = renumber ] || die_usage

# ---------------------------------------------------------------------------------------------------------------
# renumber
git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null || { echo "RENUMBER_DIRTY"; exit 1; }
[ -z "$(git ls-files -u | head -n 1)" ] || { echo "RENUMBER_DIRTY"; exit 1; }

git ls-files > "$tmp/all" || { echo "RENUMBER_FAILED ls-files"; exit 1; }
: > "$tmp/dfiles"
while IFS= read -r p; do is_decisions "$p" && [ -f "$p" ] && printf '%s\n' "$p" >> "$tmp/dfiles"; done < "$tmp/all"

# 1) 수집: NEW<TAB>파일<TAB>임시ID (머리 순서대로) · OLD<TAB>임시ID<TAB>D-NNN (이미 매긴 것의 Temp ID 줄) · MAX<TAB>파일<TAB>n
: > "$tmp/scan"
while IFS= read -r p; do
  awk -v F="$p" '
    BEGIN { max = 0; cur = "" }
    /^## D-[0-9]+ \(/ { n = substr($0, 6); sub(/[^0-9].*$/, "", n); n += 0; if (n > max) max = n; cur = sprintf("D-%03d", n); next }
    /^## D-TSK(-[0-9]+)+( |$)/ { id = $2; print "NEW\t" F "\t" id; cur = ""; next }
    /^## / { cur = ""; next }
    /^- \*\*Temp ID\*\*:[ ]*D-TSK(-[0-9]+)+[ ]*$/ { if (cur != "") { id = $0; sub(/^- \*\*Temp ID\*\*:[ ]*/, "", id); sub(/[ ]*$/, "", id); print "OLD\t" id "\t" cur } ; next }
    END { print "MAX\t" F "\t" max }' "$p" >> "$tmp/scan"
done < "$tmp/dfiles"

# 머리가 이상하게 붙은 임시 ID(예 D-TSK-01-02-1x)는 NEW 로 잡히지 않는다 — 정규식이 숫자 묶음으로 끝나야 한다.
for f in "$tmp"/dup "$tmp"/map "$tmp"/renames; do : > "$f"; done
# 같은 임시 ID 가 머리로 두 번 이상(파일 무관) 나오거나, 이미 매긴 것(OLD)과 겹치면 모호하다 → 그 ID 만 건너뛴다
awk -F '\t' '$1 == "NEW" { c[$3]++ } $1 == "OLD" { o[$2]++ } END { for (k in c) if (c[k] > 1 || (k in o)) print k }' "$tmp/scan" | sort > "$tmp/dup"
while IFS= read -r d; do [ -n "$d" ] && echo "RENUMBER_DUP $d"; done < "$tmp/dup"

# 2) 번호 배정: 파일마다 그 파일의 최대 전역 번호 + 1 부터 머리 순서대로
awk -F '\t' -v DUP="$tmp/dup" '
  BEGIN { while ((getline l < DUP) > 0) if (l != "") dup[l] = 1 }
  $1 == "MAX" { max[$2] = $3 + 0; next }
  { rows[++n] = $0 }
  END {
    for (i = 1; i <= n; i++) {
      split(rows[i], a, "\t")
      if (a[1] == "NEW") { if (a[3] in dup) continue; m = ++max[a[2]]; printf "%s\t%s\t%s\n", a[3], sprintf("D-%03d", m), a[2] }
      else if (a[1] == "OLD") { if (a[2] in dup) continue; printf "%s\t%s\t-\n", a[2], a[3] }
    }
  }' "$tmp/scan" > "$tmp/map"
awk -F '\t' '$3 != "-"' "$tmp/map" > "$tmp/renames"

# 3) 머리 바꾸기(+ Temp ID 줄) → 4) 추적 파일 전체의 참조 치환. Temp ID 줄은 치환하지 않는다(추적 근거).
# 실패하면 자기가 고친 파일을 HEAD 판으로 되돌리고 끝낸다(시작할 때 트리가 깨끗했으므로 안전하다). 호출자는 머지를
# 막지 않고 다음 단계로 가므로, 반쯤 고친 파일이 state.json 커밋에 섞이면 안 된다.
fail() {
  echo "RENUMBER_FAILED $1"
  sort -u "$tmp/changed" 2>/dev/null | while IFS= read -r c; do
    git reset -q -- "$c" 2>/dev/null; git checkout -q -- "$c" 2>/dev/null
  done
  exit 1
}
: > "$tmp/changed"
if [ -s "$tmp/renames" ]; then
  cut -f3 "$tmp/renames" | sort -u > "$tmp/rfiles"
  while IFS= read -r p; do
    awk -v MAP="$tmp/renames" -v F="$p" '
      BEGIN { FS = "\n"; while ((getline l < MAP) > 0) { split(l, a, "\t"); if (a[3] == F) to[a[1]] = a[2] } }
      /^## D-TSK(-[0-9]+)+( |$)/ {
        split($0, w, " "); id = w[2]
        if (id in to) { rest = substr($0, 4 + length(id)); print "## " to[id] rest; print "- **Temp ID**: " id; next }
      }
      { print }' "$p" > "$tmp/out" || fail "rewrite $p"
    cmp -s "$tmp/out" "$p" || { cat "$tmp/out" > "$p" && printf '%s\n' "$p" >> "$tmp/changed"; }
  done < "$tmp/rfiles"
fi

if [ -s "$tmp/map" ]; then
  git grep -l -I -E "$TEMP_RE" -- . > "$tmp/reffiles" 2>/dev/null || :
  while IFS= read -r p; do
    [ -f "$p" ] || continue
    awk -v MAP="$tmp/map" '
      BEGIN { while ((getline l < MAP) > 0) { split(l, a, "\t"); to[a[1]] = a[2] } }
      /^- \*\*Temp ID\*\*:/ { print; next }
      {
        s = $0; out = ""
        while (match(s, /D-TSK(-[0-9]+)+/)) {
          tok = substr(s, RSTART, RLENGTH); pre = substr(s, 1, RSTART - 1); prev = substr(pre, length(pre), 1)
          if ((tok in to) && prev !~ /[A-Za-z0-9_-]/) out = out pre to[tok]; else out = out pre tok
          s = substr(s, RSTART + RLENGTH)
        }
        print out s
      }' "$p" > "$tmp/out" || fail "refs $p"
    cmp -s "$tmp/out" "$p" || { cat "$tmp/out" > "$p" && printf '%s\n' "$p" >> "$tmp/changed"; }
  done < "$tmp/reffiles"
fi

# merge=union 경고: 양쪽 블록이 필드 줄을 공유하면 union 이 블록을 섞는다(샌드박스 실측). 이 스크립트의 merge-conflicts 가 대신한다.
while IFS= read -r p; do
  git check-attr merge -- "$p" 2>/dev/null | grep -q ': merge: union$' && echo "UNION_SET $p"
done < "$tmp/dfiles"

sort -u "$tmp/changed" > "$tmp/changed.u"
if [ ! -s "$tmp/changed.u" ]; then echo "NO_TEMP_IDS"; exit 0; fi

while IFS="$(printf '\t')" read -r id num f; do echo "RENUMBERED $id=$num $f"; done < "$tmp/renames"
echo "REFS $(wc -l < "$tmp/changed.u" | tr -d ' ')"
while IFS= read -r p; do git add -- "$p" || fail "add $p"; done < "$tmp/changed.u"
summary=$(awk -F '\t' '{ printf "%s%s→%s", (NR > 1 ? ", " : ""), $1, $2 }' "$tmp/renames")
[ -n "$summary" ] || summary="남은 임시 ID 참조 치환"
subject="chore${tsk:+($tsk)}: 결정 번호 매김 ($summary)"
if [ -n "$order" ]; then
  git commit -q -m "$subject" -m "공용 decisions.md 의 임시 ID 를 머지 시점의 다음 전역 번호로 바꾼다(/dflow-merge 결정 번호 매김)." --trailer "DFlow-Order: $order" \
    || fail commit
else
  git commit -q -m "$subject" -m "공용 decisions.md 의 임시 ID 를 머지 시점의 다음 전역 번호로 바꾼다(/dflow-merge 결정 번호 매김)." \
    || fail commit
fi
echo "COMMITTED $(git rev-parse HEAD)"
