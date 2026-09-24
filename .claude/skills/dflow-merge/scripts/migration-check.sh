#!/bin/sh
# 마이그레이션 버전 관문 — /dflow-merge 가 머지 전(스윕)과 해소 게이트(--resolve)에서 부른다(SKILL.md 「마이그레이션 버전 관문」).
#
# 배경(2026-09-24 dmes-standard mdm): Flyway 는 파일명 V<버전>__<설명>.sql 이 곧 버전이다. 병렬 브랜치가 같은 다음
# 번호를 고르면(TSK-04-02 의 V4__term_abbr_index_relax vs 개발 브랜치의 V4__create_mdm_interface_layout) 파일명이 달라
# git 충돌 없이 머지되고, 개발 브랜치에서 Flyway 가 "more than one migration with version 4" 로 기동에 실패한다.
# 텍스트 충돌이 아니므로 해소 워커도 잡지 못했다. 이 스크립트는 합친 트리를 폴더별로 보고 두 가지를 잡는다.
#   DUP   같은 폴더에 같은 버전이 둘 이상(이 브랜치가 추가한 파일이 끼어 있을 때만. 개발 브랜치 자체의 중복은 경고만)
#   ORDER 역순 도착 — 이 브랜치가 추가한 버전이 그 폴더의 개발 브랜치 최대 버전보다 작다(같으면 DUP)
#         Flyway 기본값 outOfOrder=false 에서는 이미 더 높은 버전을 적용한 DB 가 이 파일을 거부하거나 건너뛴다.
#
# 대상: Flyway 기본 패턴 V<숫자[._숫자…]>__<설명>.sql(대소문자 구분). R__(반복)·U(undo) 는 보지 않는다.
# 버전 비교는 Flyway 규칙: `_` 는 `.` 과 같고, 부분마다 숫자로 비교하며(앞의 0 무시), 끝의 0 부분은 없는 것과 같다
# (V1 = V1.0 = V01). 폴더 단위로 묶는 이유: 방언별 폴더(db/migration/mdm/sqlite · …/mssql)가 같은 버전을 나란히 두는
# 것이 정상이며, Flyway locations 는 보통 그 폴더 하나를 가리킨다. 한 location 아래 하위 폴더로 나눠 두는 리포는
# 하위 폴더 간 중복을 이 검사가 보지 못한다(한계).
#
# 사용:
#   migration-check.sh [-C <dir>] [--allow-out-of-order] <기준 ref> <머지 대상 ref>
#       기준 트리(개발 브랜치) + 머지 대상이 merge-base 이후 추가한 파일을 본다(머지 전 스윕).
#   migration-check.sh [-C <dir>] [--allow-out-of-order] --staged
#       HEAD 트리 + index 에서 HEAD 에 없는 추가 파일을 본다(커밋 없이 머지한 해소 트리의 게이트).
#   --allow-out-of-order(또는 환경변수 DFLOW_MIGRATION_OUT_OF_ORDER=1): 대상 리포가 Flyway outOfOrder=true 로 운영할 때만.
#       ORDER 를 보지 않는다. DUP 은 늘 본다.
# 출력: MIGRATION_OK(exit 0)
#       MIGRATION_DUP <폴더> <버전> <파일명,…> · MIGRATION_ORDER <폴더> <파일명> <버전> <= <개발 브랜치 최대> ·
#       MIGRATION_FILES <이 브랜치가 추가한 걸린 파일 경로,…>(exit 1)
#       MIGRATION_DEV_DUP <폴더> <버전> <파일명,…>(경고. 개발 브랜치 자체의 중복 — 이 머지를 막지 않는다)
#       MIGRATION_CHECK_FAILED <사유>(exit 2 — 판정 불가, 호출자는 머지하지 않는다)
set -u
allow=${DFLOW_MIGRATION_OUT_OF_ORDER:-0}; dir=.; staged=0; set_refs=
usage() { echo "MIGRATION_CHECK_FAILED usage: migration-check.sh [-C <dir>] [--allow-out-of-order] (<기준> <대상> | --staged)"; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    -C) [ $# -ge 2 ] || usage; dir=$2; shift 2 ;;
    --allow-out-of-order) allow=1; shift ;;
    --staged) staged=1; shift ;;
    -*) usage ;;
    *) set_refs="$set_refs $1"; shift ;;
  esac
done
cd "$dir" 2>/dev/null || { echo "MIGRATION_CHECK_FAILED cd $dir"; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "MIGRATION_CHECK_FAILED not-a-repo"; exit 2; }
tmp=$(mktemp -d 2>/dev/null || mktemp -d -t dflowmig) || { echo "MIGRATION_CHECK_FAILED mktemp"; exit 2; }
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
G() { git -c core.quotePath=false "$@"; }

if [ "$staged" = 1 ]; then
  [ -z "$set_refs" ] || usage
  G ls-tree -r --name-only HEAD > "$tmp/dev" 2>/dev/null || { echo "MIGRATION_CHECK_FAILED ls-tree HEAD"; exit 2; }
  G diff --cached --name-only --no-renames --diff-filter=A HEAD > "$tmp/add" 2>/dev/null || { echo "MIGRATION_CHECK_FAILED diff --cached"; exit 2; }
else
  set -- $set_refs
  [ $# -eq 2 ] || usage
  base=$1; target=$2
  git rev-parse -q --verify "$base^{commit}" >/dev/null || { echo "MIGRATION_CHECK_FAILED no-ref $base"; exit 2; }
  git rev-parse -q --verify "$target^{commit}" >/dev/null || { echo "MIGRATION_CHECK_FAILED no-ref $target"; exit 2; }
  mb=$(git merge-base "$base" "$target") || { echo "MIGRATION_CHECK_FAILED no-merge-base"; exit 2; }
  G ls-tree -r --name-only "$base" > "$tmp/dev" 2>/dev/null || { echo "MIGRATION_CHECK_FAILED ls-tree $base"; exit 2; }
  G diff --name-only --no-renames --diff-filter=A "$mb" "$target" > "$tmp/add" 2>/dev/null || { echo "MIGRATION_CHECK_FAILED diff $mb $target"; exit 2; }
fi

awk -v ALLOW="$allow" -v DEVF="$tmp/dev" -v ADDF="$tmp/add" '
  # 버전 문자열 → 정규형("1.2", 앞 0·끝 0 부분 제거). 비교는 부분별로 길이 → 사전순(큰 수도 정밀도 손실 없이).
  function norm(v,   n, p, i, out, last) {
    n = split(v, p, /[._]/)
    for (i = 1; i <= n; i++) { sub(/^0+/, "", p[i]); if (p[i] == "") p[i] = "0" }
    last = n; while (last > 1 && p[last] == "0") last--
    out = p[1]; for (i = 2; i <= last; i++) out = out "." p[i]
    return out
  }
  function cmp(a, b,   x, y, nx, ny, i, m, s, t) {
    nx = split(a, x, "."); ny = split(b, y, "."); m = (nx > ny ? nx : ny)
    for (i = 1; i <= m; i++) {
      s = (i <= nx ? x[i] : "0"); t = (i <= ny ? y[i] : "0")
      if (length(s) != length(t)) return (length(s) < length(t) ? -1 : 1)
      if (s != t) return (s < t ? -1 : 1)
    }
    return 0
  }
  # 경로 → 폴더·파일명·버전. 패턴이 아니면 0
  function parse(path,   b, d, v) {
    b = path; d = ""
    if (match(path, /.*\//)) { d = substr(path, 1, RLENGTH - 1); b = substr(path, RLENGTH + 1) }
    if (b !~ /^V[0-9]+([._][0-9]+)*__.+\.sql$/) return 0
    v = substr(b, 2); sub(/__.*$/, "", v)
    P_DIR = d; P_BASE = b; P_VER = norm(v)
    return 1
  }
  BEGIN {
    while ((getline l < DEVF) > 0) { dev_path[l] = 1; if (parse(l)) { k = P_DIR SUBSEP P_VER; cnt[k]++; names[k] = names[k] (names[k] == "" ? "" : ",") P_BASE; dirs[P_DIR] = 1
        if (!(P_DIR in max) || cmp(P_VER, max[P_DIR]) > 0) max[P_DIR] = P_VER } }
    while ((getline l < ADDF) > 0) { if (l in dev_path) continue; if (parse(l)) { na++; ap[na] = l; ad[na] = P_DIR; ab[na] = P_BASE; av[na] = P_VER } }
    # 추가 파일을 합친다(개발 브랜치 자체의 중복은 아래에서 hit_add 가 없으므로 경고로만 나온다)
    for (i = 1; i <= na; i++) { k = ad[i] SUBSEP av[i]; cnt[k]++; names[k] = names[k] (names[k] == "" ? "" : ",") ab[i]; hit_add[k] = 1 }
    bad = 0
    for (k in cnt) {
      if (cnt[k] < 2) continue
      split(k, kk, SUBSEP)
      if (k in hit_add) { printf "MIGRATION_DUP %s V%s %s\n", (kk[1] == "" ? "." : kk[1]), kk[2], names[k]; bad = 1; dupk[k] = 1 }
      else printf "MIGRATION_DEV_DUP %s V%s %s\n", (kk[1] == "" ? "." : kk[1]), kk[2], names[k]
    }
    for (i = 1; i <= na; i++) {
      k = ad[i] SUBSEP av[i]
      if (k in dupk) { files = files (files == "" ? "" : ",") ap[i]; continue }
      if (ALLOW != "1" && (ad[i] in max) && cmp(av[i], max[ad[i]]) < 0) {
        printf "MIGRATION_ORDER %s %s V%s <= V%s\n", (ad[i] == "" ? "." : ad[i]), ab[i], av[i], max[ad[i]]
        bad = 1; files = files (files == "" ? "" : ",") ap[i]
      }
    }
    if (bad) { print "MIGRATION_FILES " files; exit 1 }
    print "MIGRATION_OK"; exit 0
  }' | sort > "$tmp/out"
if grep -q '^MIGRATION_OK$' "$tmp/out"; then rc=0
elif grep -q '^MIGRATION_FILES ' "$tmp/out"; then rc=1
else echo "MIGRATION_CHECK_FAILED awk"; exit 2   # 판정 줄이 없다 — 통과로 읽지 않는다
fi
# 정렬하면 FILES 줄이 앞 순서가 섞이므로 FILES 는 마지막에 낸다
grep -v '^MIGRATION_FILES ' "$tmp/out"
grep '^MIGRATION_FILES ' "$tmp/out"
exit $rc
