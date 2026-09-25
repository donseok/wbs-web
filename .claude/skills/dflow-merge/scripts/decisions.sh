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
#     줄을 남긴다), 추적 파일 전체(.claude/ 제외)의 같은 임시 ID 참조를 치환해 커밋 하나로 남긴다. 이미 번호가 매겨진 임시 ID(그 Temp ID
#     줄)의 남은 참조도 치환한다(스택 후손이 선행의 임시 ID 를 적어 둔 경우).
#     그보다 먼저(0단계) HEAD 가 머지 커밋이면 전역 번호 중복을 바로잡는다: 한 decisions.md 에 같은 `## D-NNN` 머리가 둘 이상이면
#     개발 브랜치 쪽(HEAD^1) 블록은 두고, 머지 대상(HEAD^2)이 merge-base 뒤 더한 블록을 그 파일의 다음 전역 번호로 옮겨 파일 끝에
#     둔다(바로 아래 `- **Renumbered from**: D-NNN (중복 번호)` 줄). 참조는 머지 대상이 더하거나 바꾼 파일에서만 바꾸고, 개발
#     브랜치도 바꾼 파일 등 애매한 곳은 위치만 알린다.
#     출력: RENUMBERED <임시 ID>=<D-NNN> <파일> … · REFS <파일 수> · COMMITTED <sha>(exit 0) · NO_TEMP_IDS(exit 0, 아무것도 안 함)
#           DUP_RENUMBERED <옛 D-NNN>=<새 D-NNN> <파일> · DUP_REF_REPLACED <파일> <옛→새,…>
#           DUP_REF_AMBIGUOUS <파일>:<줄> <옛 D-NNN> dev-changed|decisions|base-mention|ambiguous(경고. 바꾸지 않았다 — 사람이 본다)
#           DUP_LEFT <파일> <D-NNN> not-a-merge|no-merge-base|dev-side|ambiguous-refs(경고. 그 중복·참조는 그대로 남았다)
#           DECISIONS_SEQ <파일> at=<i> found=<D-NNN> want=<D-NNN>(경고. validate 가 실패할 순번. 고치지 않는다)
#           RENUMBER_DUP <임시 ID>(경고. 그 ID 만 건너뛴다) · UNION_SET <파일>(경고. merge=union 은 블록을 섞는다)
#           RENUMBER_DIRTY(exit 1, 트리가 깨끗하지 않음) · RENUMBER_FAILED <단계>(exit 1) · usage(exit 2)
set -u
# awk 는 바이트로 돈다. UTF-8 로캘의 macOS awk 는 match() 의 위치와 substr() 의 글자 수가 어긋나 가운뎃점(·) 같은 글자 옆
# 토큰에서 "multibyte conversion failure" 로 죽었다(샌드박스 실측). 정규식은 모두 ASCII 라 바이트로 보면 된다.
LC_ALL=C; export LC_ALL

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
while IFS= read -r p; do
  case "$p" in .claude/*) continue ;; esac   # 스킬 폴더는 결정 기록이 아니다(아래 참조 치환과 같은 제외)
  is_decisions "$p" && [ -f "$p" ] && printf '%s\n' "$p" >> "$tmp/dfiles"
done < "$tmp/all"

# 실패하면 자기가 고친 파일을 HEAD 판으로 되돌리고 끝낸다(시작할 때 트리가 깨끗했으므로 안전하다). 호출자는 머지를
# 막지 않고 다음 단계로 가므로, 반쯤 고친 파일이 state.json 커밋에 섞이면 안 된다. 0단계(중복 번호)도 이 목록에 싣는다.
fail() {
  echo "RENUMBER_FAILED $1"
  sort -u "$tmp/changed" 2>/dev/null | while IFS= read -r c; do
    git reset -q -- "$c" 2>/dev/null; git checkout -q -- "$c" 2>/dev/null
  done
  exit 1
}
: > "$tmp/changed"

# 0) 전역 번호 중복 — 옛 규칙을 읽은 워커나 사람이 D-NNN 을 직접 매겨, 개발 브랜치와 같은 번호가 한 파일에 두 번 들어온
#    경우(2026-09-24 dmes-standard TSK-08-01·TSK-04-03 이 둘 다 D-050~052). merge-conflicts 가 두 쪽 블록을 그대로
#    붙이거나, git 이 두 추가를 다른 위치로 보고 충돌 없이 합쳐도 같은 결과다. 그래서 충돌 여부와 무관하게 여기서 본다.
#    HEAD 가 머지 커밋일 때만 바로잡는다: HEAD^1 = 머지 전 개발 브랜치, HEAD^2 = 머지 대상(머지 중의 MERGE_HEAD),
#    merge-base 는 그 둘에서 구한다. 개발 브랜치 쪽 블록은 그대로 두고, 머지 대상이 더한 블록(머리 줄이 HEAD^2 판에 있고
#    merge-base 판·HEAD^1 판에 없는 것) 가운데 번호가 겹친 것만 그 파일의 다음 전역 번호로 옮긴다. 옮긴 블록은 파일 끝으로
#    보낸다(개발 브랜치 블록의 순서는 바꾸지 않는다 — merge-conflicts 가 머지 대상 블록을 끝에 붙이는 것과 같다).
: > "$tmp/dupmap"     # 파일<TAB>옛 번호<TAB>새 번호<TAB>모호(0|1)
P1=; P2=; MB=
: > "$tmp/mfiles"
if git rev-parse -q --verify 'HEAD^2' >/dev/null 2>&1; then
  P1=$(git rev-parse 'HEAD^1') && P2=$(git rev-parse 'HEAD^2') || fail "rev-parse"
  MB=$(git merge-base "$P1" "$P2" 2>/dev/null | head -n 1)
  git diff --name-only "$P1" HEAD > "$tmp/mfiles" 2>/dev/null || :
fi
GH_RE='^## D-[0-9]+ \('
while IFS= read -r p; do
  awk '/^## D-[0-9]+ \(/ { n = substr($0, 6); sub(/[^0-9].*$/, "", n); c[n + 0]++ }
       END { for (k in c) if (c[k] > 1) printf "D-%03d\n", k }' "$p" | LC_ALL=C sort > "$tmp/dupn"
  [ -s "$tmp/dupn" ] || continue
  if [ -z "$P2" ] || [ -z "$MB" ]; then
    why=not-a-merge; [ -n "$P2" ] && why=no-merge-base
    while IFS= read -r d; do echo "DUP_LEFT $p $d $why"; done < "$tmp/dupn"
    continue
  fi
  git show "$P1:$p" > "$tmp/v1" 2>/dev/null || : > "$tmp/v1"
  git show "$P2:$p" > "$tmp/v2" 2>/dev/null || : > "$tmp/v2"
  git show "$MB:$p" > "$tmp/vb" 2>/dev/null || : > "$tmp/vb"
  for v in v1 v2 vb; do grep -E "$GH_RE" "$tmp/$v" | LC_ALL=C sort -u > "$tmp/h$v"; done
  LC_ALL=C comm -23 "$tmp/hv2" "$tmp/hvb" | LC_ALL=C comm -23 - "$tmp/hv1" > "$tmp/hin"   # 머지 대상이 더한 머리
  # 두 번 읽는다. 1차: 블록 목록·최대 번호·번호별 개수 → 옮길 블록과 새 번호를 정한다. 2차: 다시 쓴다.
  # 머지 대상 블록(옮긴 것·안 옮긴 것 모두)의 본문 참조는 옮긴 번호로 바꾼다 — 머지 대상은 merge-base 뒤 개발 브랜치가
  # 더한 같은 번호를 알 수 없었으므로 그 블록 속 참조는 자기 쪽 결정이다. 개발 브랜치 블록은 한 바이트도 바꾸지 않는다.
  awk -v HIN="$tmp/hin" -v F="$p" -v MAP="$tmp/dupmap" -v OUT="$tmp/out" '
    function num(h,   n) { n = substr(h, 6); sub(/[^0-9].*$/, "", n); return n + 0 }
    function tokof(h,   t) { t = substr(h, 4); sub(/ .*$/, "", t); return t }
    function subst(line,   s, out, tok, pre, prev) {
      if (line ~ /^## / || line ~ /^- \*\*(Renumbered from|Temp ID)\*\*:/) return line
      s = line; out = ""
      while (match(s, /D-[0-9]+/)) {
        tok = substr(s, RSTART, RLENGTH); pre = substr(s, 1, RSTART - 1); prev = substr(pre, length(pre), 1)
        if ((tok in to) && !(tok in amb) && prev !~ /[A-Za-z0-9_-]/) out = out pre to[tok]; else out = out pre tok
        s = substr(s, RSTART + RLENGTH)
      }
      return out s
    }
    BEGIN { while ((getline l < HIN) > 0) inc[l] = 1; max = 0; ns = 0 }
    FNR == 1 { pass++ }
    pass == 1 {
      if ($0 ~ /^## /) {
        ns++; hd[ns] = $0; gl[ns] = ($0 ~ /^## D-[0-9]+ \(/)
        if (gl[ns]) { n = num($0); if (n > max) max = n; cnt[n]++; if (!($0 in inc)) dev[n]++ }
      }
      next
    }
    pass == 2 && FNR == 1 {
      # 번호마다 남길 것: 개발 브랜치 쪽 블록. 없으면(머지 대상끼리 겹침) 머지 대상의 첫 블록을 남기고 그 번호 참조는 모호.
      for (i = 1; i <= ns; i++) {
        if (!gl[i]) continue
        n = num(hd[i]); if (cnt[n] < 2) continue
        t = tokof(hd[i])
        if (!(hd[i] in inc)) { if (dev[n] > 1 && !(n in devw)) { devw[n] = 1; printf "DUP_LEFT %s D-%03d dev-side\n", F, n }; continue }
        if (!dev[n] && !(n in keptinc)) { keptinc[n] = 1; amb[t] = 1; continue }
        mv[i] = ++max; nm[t]++; if (nm[t] > 1) amb[t] = 1; to[t] = sprintf("D-%03d", max); ot[i] = t
      }
      for (i = 1; i <= ns; i++) if (i in mv) printf "%s\t%s\t%s\t%d\n", F, ot[i], sprintf("D-%03d", mv[i]), ((ot[i] in amb) ? 1 : 0) >> MAP
      for (t in amb) if (t in to) printf "DUP_LEFT %s %s ambiguous-refs\n", F, t
      seg = 0; pre = ""; nmv = 0
    }
    pass == 2 {
      if ($0 ~ /^## /) {
        seg++
        if (seg in mv) {
          nmv++; mvo[nmv] = seg
          body[seg] = "## " sprintf("D-%03d", mv[seg]) substr($0, 4 + length(ot[seg])) "\n- **Renumbered from**: " ot[seg] " (중복 번호)"
        } else body[seg] = $0
        isin[seg] = ($0 in inc)
        next
      }
      if (seg == 0) { pre = pre $0 "\n"; next }
      body[seg] = body[seg] "\n" ((isin[seg] || (seg in mv)) ? subst($0) : $0)
    }
    END {
      if (pass < 2) exit
      o = pre
      for (i = 1; i <= seg; i++) if (!(i in mv)) o = o body[i] "\n"
      if (nmv > 0) {
        sub(/\n+$/, "", o)
        for (k = 1; k <= nmv; k++) { b = body[mvo[k]]; sub(/\n+$/, "", b); o = o "\n\n" b }
        o = o "\n"
      }
      printf "%s", o > OUT
    }' "$p" "$p" || fail "dup $p"
  if [ -s "$tmp/out" ] && ! cmp -s "$tmp/out" "$p"; then cat "$tmp/out" > "$p" && printf '%s\n' "$p" >> "$tmp/changed"; fi
  rm -f "$tmp/out"
done < "$tmp/dfiles"

# 0-1) 옮긴 번호의 참조 치환 — 리포 전체가 아니라 머지 대상이 더하거나 바꾼 파일(merge-base..HEAD^2)만 본다. 같은
#      문자열 D-050 이 개발 브랜치 쪽 결정도 가리키기 때문이다. 자동으로 바꾸지 않고 위치만 알리는(DUP_REF_AMBIGUOUS) 경우:
#      개발 브랜치도 바꾼 파일(dev-changed) · 다른 decisions.md(Task 폴더 결정 기록은 자기 번호를 쓴다, decisions) ·
#      merge-base 판에 이미 그 번호가 있던 파일(base-mention) · 한 번호가 둘 이상으로 옮겨졌거나 머지 대상의 다른
#      decisions.md 에도 같은 번호 머리가 있음(ambiguous).
if [ -s "$tmp/dupmap" ]; then
  git diff --name-only "$MB" "$P2" > "$tmp/bfiles" 2>/dev/null || fail "diff branch"
  git diff --name-only "$MB" "$P1" > "$tmp/devf" 2>/dev/null || fail "diff dev"
  cut -f1 "$tmp/dupmap" | sort -u > "$tmp/dupf"
  # 머지 대상이 바꾼 다른 decisions.md 의 전역 번호 머리 → 그 번호는 브랜치 문서에서도 모호하다
  : > "$tmp/othernums"
  while IFS= read -r f; do
    case "$f" in .claude/*) continue ;; esac
    is_decisions "$f" && [ -f "$f" ] && ! grep -qxF -- "$f" "$tmp/dupf" || continue
    awk '/^## D-[0-9]+ \(/ { n = substr($0, 6); sub(/[^0-9].*$/, "", n); print n + 0 }' "$f" >> "$tmp/othernums"
  done < "$tmp/bfiles"
  awk -F '\t' -v O="$tmp/othernums" '
    BEGIN { while ((getline l < O) > 0) on[l + 0] = 1 }
    { c[$2]++; to[$2] = $3; if ($4 == 1) a[$2] = 1 }
    END { for (k in c) { n = substr(k, 3) + 0; print k "\t" ((c[k] > 1 || (k in a) || (n in on)) ? "-" : to[k]) } }' "$tmp/dupmap" > "$tmp/toks"
  while IFS= read -r f; do
    case "$f" in .claude/*) continue ;; esac
    [ -f "$f" ] || continue
    grep -qxF -- "$f" "$tmp/dupf" && continue            # 0단계가 블록 단위로 이미 처리했다
    grep -I -q -E 'D-[0-9]+' -- "$f" 2>/dev/null || continue
    why=
    if is_decisions "$f"; then why=decisions
    elif grep -qxF -- "$f" "$tmp/devf"; then why=dev-changed
    fi
    git show "$MB:$f" > "$tmp/fb" 2>/dev/null || : > "$tmp/fb"
    awk -v TOKS="$tmp/toks" -v BASEF="$tmp/fb" -v WHY="$why" -v F="$f" -v OUT="$tmp/out" -v REP="$tmp/rep" '
      BEGIN {
        while ((getline l < TOKS) > 0) { split(l, a, "\t"); to[a[1]] = a[2] }
        while ((getline l < BASEF) > 0) { s = l; while (match(s, /D-[0-9]+/)) { t = substr(s, RSTART, RLENGTH); if (t in to) inb[t] = 1; s = substr(s, RSTART + RLENGTH) } }
        o = ""; done = ""
      }
      /^## D-[0-9]+ \(/ { print > OUT; next }   # 다른 결정 기록의 자기 머리 줄은 참조가 아니다
      {
        s = $0; out = ""
        while (match(s, /D-[0-9]+/)) {
          tok = substr(s, RSTART, RLENGTH); pre = substr(s, 1, RSTART - 1); prev = substr(pre, length(pre), 1)
          if ((tok in to) && prev !~ /[A-Za-z0-9_-]/) {
            r = WHY; if (r == "" && (tok in inb)) r = "base-mention"; if (r == "" && to[tok] == "-") r = "ambiguous"
            if (r != "") { printf "DUP_REF_AMBIGUOUS %s:%d %s %s\n", F, FNR, tok, r; out = out pre tok }
            else { out = out pre to[tok]; if (!(tok in rep)) { rep[tok] = 1; done = done (done == "" ? "" : ",") tok "→" to[tok] } }
          } else out = out pre tok
          s = substr(s, RSTART + RLENGTH)
        }
        print out s > OUT
      }
      END { if (done != "") print done > REP }' "$f" || fail "dup refs $f"
    if [ -s "$tmp/rep" ] && [ -f "$tmp/out" ] && ! cmp -s "$tmp/out" "$f"; then
      cat "$tmp/out" > "$f" && printf '%s\n' "$f" >> "$tmp/changed" && echo "DUP_REF_REPLACED $f $(cat "$tmp/rep")"
    fi
    rm -f "$tmp/out" "$tmp/rep"
  done < "$tmp/bfiles"
fi

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
#    실패 처리(fail)는 0단계 앞에서 정의했다.
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
  # .claude/ 는 치환하지 않는다 — 킷 복사형 리포에서 스킬 문서·이 스크립트의 예시 ID 가 실제 Task ID 와 겹치면 킷이 바뀐다
  git grep -l -I -E "$TEMP_RE" -- . ':(exclude).claude' > "$tmp/reffiles" 2>/dev/null || :
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

# 순번 경고: validate 는 D-001 부터 파일 순서대로 끊김 없는 번호를 요구한다. 이번 머지(HEAD^1..HEAD)나 이번 실행이 바꾼
# 결정 기록만 본다(옛 리포의 묵은 끊김이 머지마다 울리지 않게). 머지 대상이 직접 매겼지만 겹치지 않은 번호(건너뛴 번호·
# 앞 번호를 뒤에 둔 것)는 고치지 않는다 — 번호를 바꾸면 겹치지 않은 결정의 참조까지 흔들리고, 블록을 옮기면 추가만 하는
# 기록의 순서를 바꾼다. 알리기만 한다.
cat "$tmp/mfiles" "$tmp/changed.u" | sort -u > "$tmp/seqf"
while IFS= read -r p; do
  case "$p" in .claude/*) continue ;; esac
  is_decisions "$p" && [ -f "$p" ] || continue
  awk -v F="$p" '/^## D-[0-9]+ \(/ { i++; n = substr($0, 6); sub(/[^0-9].*$/, "", n); n += 0
      if (n != i) { printf "DECISIONS_SEQ %s at=%d found=D-%03d want=D-%03d\n", F, i, n, i; exit } }' "$p"
done < "$tmp/seqf"

if [ ! -s "$tmp/changed.u" ]; then echo "NO_TEMP_IDS"; exit 0; fi

while IFS="$(printf '\t')" read -r f old new a; do echo "DUP_RENUMBERED $old=$new $f"; done < "$tmp/dupmap"
while IFS="$(printf '\t')" read -r id num f; do echo "RENUMBERED $id=$num $f"; done < "$tmp/renames"
echo "REFS $(wc -l < "$tmp/changed.u" | tr -d ' ')"
while IFS= read -r p; do git add -- "$p" || fail "add $p"; done < "$tmp/changed.u"
summary=$({ awk -F '\t' '{ print $2 "→" $3 "(중복)" }' "$tmp/dupmap"; awk -F '\t' '{ print $1 "→" $2 }' "$tmp/renames"; } \
  | awk '{ printf "%s%s", (NR > 1 ? ", " : ""), $0 }')
[ -n "$summary" ] || summary="남은 임시 ID 참조 치환"
subject="chore${tsk:+($tsk)}: 결정 번호 매김 ($summary)"
body="공용 decisions.md 의 임시 ID 를 머지 시점의 다음 전역 번호로 바꾼다(/dflow-merge 결정 번호 매김)."
[ -s "$tmp/dupmap" ] && body="$body 머지 대상이 직접 매겨 개발 브랜치와 겹친 전역 번호는 개발 브랜치 쪽을 두고 머지 대상 쪽을 다음 번호로 옮긴다(옛 번호는 Renumbered from 줄)."
if [ -n "$order" ]; then
  git commit -q -m "$subject" -m "$body" --trailer "DFlow-Order: $order" || fail commit
else
  git commit -q -m "$subject" -m "$body" || fail commit
fi
echo "COMMITTED $(git rev-parse HEAD)"
