# /dflow-team 자동 재시작: 멈춘 팀원을 원인별로 다시 띄운다

스펙 wbs-web docs/superpowers/specs/2026-09-23-worker-auto-restart-design.md(과제 H·G). SKILL.md 「2-3」「3. 결과 처리」
「5. 팀원 spawn」「5-1. 재개 spawn」「7. 마감」 이 이 문서를 부른다. 블록은 events.md 의 기록 명령처럼 **그대로**
쓰고 기억으로 재구성하지 않는다. 이벤트는 events.md 「기록 명령」 의 블록과 `team.lost` 조각으로만 기록한다.

## 요약

- 자동 재시작 대상은 셋이다. **무응답**(생존 증거가 두 TICK 연속 무변화), **pane 죽음**(tmux, 결과 줄 없음,
  `pane_dead_status` 가 127 이 아님), **rate-limit**(한도 해제 뒤 1회).
- 권한 거부·`blocked`·`cancelled`·그 밖 `failed…`(결과 줄이 있는 것 전부)·127·서버가 `claimed`+`mine`+이 PC 가
  아님·워크트리 `state.json` 이 `cancelled` 는 재시작하지 않고 사람에게 알린다.
- 재시도는 고아 재개와 같은 카운터를 쓴다(상한 3, SKILL.md 「팀장 상태」 고아 스캔 2번). 손실은 `team.result`
  가 아니라 `team.lost` 로 적는다. `team.result` 는 카운터를 0 으로 되돌린다.
- 재투입은 「5-1. 재개 spawn」 그대로다. 같은 워크트리, 같은 슬롯 번호, claim 하지 않음.
- Orca 는 실측 관문 전이라 재투입하지 않는다(「Orca」).
- 화면(tmux `capture-pane`, Orca `orca terminal read`)은 생존 판정에 쓰지 않는다. 결과 줄 폴백과, 켜 두었을 때의
  한도 문구 판정에만 쓴다.

## 이벤트로 본 상태

id8 마다 마지막 `team.spawn`·`team.blocked`·`team.result`·`team.lost` 를 본다. `team.start` 로 자르지 않는다.
이유: 팀장을 다시 띄워도 재시작 대기와 rate-limit 대기가 이어져야 한다. 매 기상의 재구성에서 한 번 돈다.
```bash
jq -r --arg a '<신원>/<host>/lead' --arg r '<MAIN>' \
  'select(.agent == $a and .repo == $r and (.id8 // "-") != "-")
   | select(.event == "team.spawn" or .event == "team.blocked" or .event == "team.result" or .event == "team.lost")
   | [.id8, .event, (.cause // "-"), (.next // "-"), (.restart_at // "-"), (.worktree // "-"), (.evidence // "-"), (.slot // "-")]
   | @tsv' ~/.dflow/events.jsonl 2>/dev/null \
  | awk -F '\t' '{ last[$1] = $0 } END { for (k in last) print last[k] }' \
  | awk -F '\t' -v now="$(date +%s)" '$2 == "team.lost" {
      if ($4 == "park") s = "PARKED"
      else if ($3 == "rate-limit" && $4 == "wait") s = (($5 != "-") && ($5 + 0 > now + 0)) ? "RL_WAIT" : "RL_DUE"
      else s = "RESTART_DUE"
      print s "\t" $1 "\t" $3 "\t" $5 "\t" $6 "\t" $7 "\t" $8 }'
```
출력 줄은 `<상태>\t<id8>\t<cause>\t<restart_at>\t<worktree>\t<evidence>\t<slot>` 이며 마지막 이벤트가 `team.lost` 인
id8 만 나온다.

| 상태 | 뜻 | 처리 |
|---|---|---|
| `RESTART_DUE` | `next` 가 `restart`(기록 뒤 spawn 전에 끊김) 또는 `wait`(차단기·보류로 미룸) | **재시작 대기 목록**. SKILL.md 「2-3」 4번의 재개 대상이며 새 작업보다 먼저다. 「재투입」 의 재투입 전 확인(`REINJECT_OK`)을 통과할 때만 띄운다 |
| `RL_WAIT` | rate-limit 대기, `restart_at` 전 | 「rate-limit 대기」. 무응답 판정에서 뺀다 |
| `RL_DUE` | rate-limit 대기, `restart_at` 이 지났다 | 「rate-limit 대기」 의 재측정 |
| `PARKED` | `next=park` | 「멈춤」 표에 둔다. 자동으로 다시 띄우지 않는다 |

- 네 상태의 id8 은 모두 **영구 제외(진행 중)** 다. poll `--exclude` 에 넣는다.
- `RL_WAIT`·`RL_DUE` 가 하나라도 있으면 **rate-limit 보류**다. 새 작업·재개·재시작 spawn 을 모두 하지 않고 poll 도
  다시 띄우지 않는다. 이유: 한도는 계정 단위라 팀장·팀원이 같은 로그인이면 누구를 띄워도 같은 벽에 선다. 예외는
  `RL_DUE` 슬롯 자신의 재투입 하나다(보류를 푸는 길이다).
- 고아 스캔 "재개 가능" 의 다섯째 조건: 그 id8 이 `PARKED`·`RL_WAIT`·`RL_DUE` 면 재개하지 않는다. `RL_DUE` 는
  「rate-limit 대기」 가 재측정한 뒤 띄운다. `RESTART_DUE` 는 그 자체로 재개 가능이 아니다. 고아 스캔 "재개
  가능" 조건(서버 `claimed`+`mine`+이 PC, 재시도 3 미만, 살아 있는 팀원 없음)과의 **교집합**일 때만 띄우며, 그 판정은
  「재투입」 의 재투입 전 확인 블록이 이번 기상의 값으로 한다. 이벤트는 과거의 기록이라 그 사이 서버 status 가 바뀌었거나
  (사람이 중단·재배정) 다른 기상이 이미 띄웠을 수 있다. 고아 스캔 목록과는 id8 으로 합쳐 한 번만 띄운다.

## 판정

**언제**: `TICK` 기상(결과 줄 없는 진행 슬롯 전부. `blocked` 는 뺀다)과 `PANE_DEAD` 기상(그 슬롯. `.result` 도 죽은
pane 화면 폴백의 결과 줄도 없을 때만). 그 밖의 기상과 「마감·lease·잠금」 의 경우에는 판정하지 않는다.

**먼저**: 그 id8 이 「이벤트로 본 상태」 에서 `RL_WAIT`·`RL_DUE` 면 이 절을 건너뛰고 「rate-limit 대기」 만 따른다.
그 사이 pane 이 죽어도 여기서 재시작하지 않는다. 같은 한도를 두 번 세지 않기 위해서다.

**정체 슬롯만 가른다**: (가) pane 이 죽었다, 또는 (나) 생존 증거(SKILL.md 「3. 결과 처리」 의 셋)가 직전 TICK 과
같다. 정체가 아닌 슬롯은 판정하지 않는다. 이유: 움직이는 워커를 한도로 분류하거나, 결과 보고 직전의 정상
전이(`reported`)를 점유 변동으로 멈추지 않게 한다. 중단(`cancelled`) 처리는 종전대로 정체와 무관하게 한다.

정체 슬롯마다 아래 블록을 한 번 돈다(한 번의 Bash 호출). `<TASKS>` 는 그 슬롯 포인터(`.dflow-prompt`)의 `TASK_DIR` 부모이며,
비어 있으면(옛 팀장) `docs/tasks` 다.
```bash
w='<워크트리>'; id8='<id8>'; tsk='<TSK>'; tasks='<TASKS>'; TM='<진짜 tmux 절대경로 또는 빈 값>'; pane='<pane id 또는 ->'
g=$( (.claude/skills/dflow-work/scripts/dflow.sh show "$id8") 2>/dev/null \
  | jq -c --arg h 'claude-<host>' 'select((.order.id // "") != "") | .order
      | {id, status, mine, same_host: (((.claimed_by // "") | ascii_downcase) as $c | $c == $h or (($c | split("/")) as $p | ($p | length) == 3 and $p[1] == ($h | ltrimstr("claude-"))))}' 2>/dev/null )
[ -n "$g" ] || g=SHOW_FAILED
printf 'gate=%s\n' "$g"
p=$(jq -r '.phase // "-"' "$w/$tasks/$tsk/state.json" 2>/dev/null) || p=-
printf 'local_phase=%s\n' "${p:--}"
if [ "$pane" != - ] && [ -n "$TM" ]; then
  printf 'dead_status=%s\n' "$("$TM" -L dflow display-message -p -t "$pane" '#{pane_dead_status}' 2>/dev/null)"
fi
```
위에서부터 보고 처음 맞는 줄에서 멈춘다. "(나) 1회째" 는 이번 TICK 이 그 슬롯의 첫 무변화 TICK 이라는 뜻이다.

| 순서 | 조건 | 분류 | (나) 1회째 | (가), 또는 (나) 2회째 |
|---|---|---|---|---|
| 1 | `gate=SHOW_FAILED` | 측정 실패 | 아무것도 하지 않는다 | (나)는 아무것도 하지 않는다. (가)는 「재시작 후보를 띄울지」 의 거두기 블록만 돌고 감시 루프의 `set --` 에서 뺀다(죽은 pane 이 20초마다 다시 깨우지 않게). 다음 기상의 고아 스캔이 다시 본다. 같은 슬롯이 두 TICK 연속 측정 실패면 「멈춤」 표에 사유 `서버 조회 실패` 로 보고한다(슬롯 유지) |
| 2 | `status` 가 `cancelled` | 중단 | SKILL.md 「3. 결과 처리」 의 중단 처리 | 같다. 재시작 없음 |
| 3 | `status` 가 `claimed` 가 아님, 또는 `mine` 이 거짓, 또는 `same_host` 가 거짓 | 점유 변동 | 보고만 한다 | 거두기 → 슬롯 해제 → 「멈춤」(사유 `서버 <status>` 또는 `다른 PC claim`). **이벤트는 쓰지 않는다** |
| 4 | `local_phase=cancelled` | 표식 불일치 | 보고만 한다 | 거두기 → `team.lost`(`next=park`) → 「멈춤」(사유 `중단 표식 불일치`). 사람이 phase 를 되돌릴지 판단한다 |
| 5 | 「한도 판정」 이 `LIMIT_HIT` | rate-limit | 「rate-limit 대기」 의 감지(두 TICK 을 기다리지 않는다) | 같다 |
| 6 | (가)이고 `dead_status=127` | 환경 결함 | — | 현행 `failed no-result`(SKILL.md 「3. 결과 처리」). 재시작 없음. `claude` 를 찾지 못한 것이라 다시 띄워도 같은 자리에서 죽는다 |
| 7 | (가) 그 밖 | pane 죽음 | — | 재시작 후보(`cause=pane-dead`) |
| 8 | (나) 2회째 | 무응답 | — | 재시작 후보(`cause=no-response`) |
| 9 | (나) 1회째 | 무응답 1회 | 현행 "무응답" 보고만 한다 — 단 SKILL.md 「3. 결과 처리」 「서브에이전트 종료 후 정지 패턴」 의 화면 조건에 맞으면 보고 대신 그 절대로 곧바로 지시를 주입한다 | — |

4번의 `team.lost` 는 (가)면 `cause=pane-dead`, (나)면 `cause=no-response`, `restart_at` 은 `-` 다. `park` 로 적는
이유: 서버는 여전히 `claimed`·`mine` 이라 적지 않으면 다음 팀장 시작의 고아 스캔이 재시도 3 미만으로 보고 같은 작업을
다시 띄운다. 3번은 적지 않는다. 고아 스캔은 `claimed`+`mine`+이 PC 가 아니면 어차피 재개하지 않으며, 「이벤트로 본
상태」 는 `team.start` 로 자르지 않으므로 `park` 를 적으면 claim 전에 죽은 `ready` 작업이 이 팀장에게 영영 보이지 않게 된다.

## 한도 판정

출처는 tmux 팀원의 statusLine 덤프 `~/.dflow/limits/<id8>.json` 이다(backends.md 「pane(tmux)」 의 `.dflow-run`
설정이 쓴다. 워크트리 밖이라 `git status` 를 더럽히지 않는다). 어느 창이든 `used_percentage >= 100` 이고 해제
시각이 미래면 한도이며, 해제 시각은 그런 창의 `resets_at` 중 가장 늦은 것이다. `restart_at` = 해제 시각 + 600초.
유예 10분을 두는 이유: Claude Code 가 한도 해제 뒤 스스로 이어 가면 그 사이에 워커가 돈다.
화면 문구 판정(`LIMIT_SCREEN_RE`)은 **꺼져 있다.** 실제 한도 화면 문장과 시각 형식을 캡처로 확인하는 실측(스펙
§14-1) 전에는 채우지 않는다. 켜면 문구가 보일 때 `restart_at` = 감지 + 3600초(시각을 읽지 않는 폴백)다.
Orca 팀원은 `.dflow-run` 을 쓰지 않아 덤프가 없으므로 늘 `LIMIT_NONE` 이다.
```bash
id8='<id8>'; pane='<pane id 또는 ->'; TM='<진짜 tmux 절대경로 또는 빈 값>'
LIMIT_SCREEN_RE=''   # 끔. 실측(스펙 §14-1) 전에는 채우지 않는다
f="$HOME/.dflow/limits/$id8.json"; now=$(date +%s)
lim=$(jq -r --argjson now "$now" '[(.rate_limits // {}) | to_entries[] | .value
    | select(((.used_percentage // 0) >= 100) and ((.resets_at // 0) > $now)) | .resets_at]
    | if length == 0 then "none" else (max | floor | tostring) end' "$f" 2>/dev/null) || lim=none
[ -n "$lim" ] || lim=none
if [ "$lim" = none ] && [ -n "$LIMIT_SCREEN_RE" ] && [ "$pane" != - ] && [ -n "$TM" ]; then
  if "$TM" -L dflow capture-pane -p -J -S -40 -t "$pane" 2>/dev/null | grep -Eq "$LIMIT_SCREEN_RE"; then lim=screen; fi
fi
case "$lim" in
  none) echo LIMIT_NONE ;;
  screen) echo "LIMIT_HIT source=screen restart_at=$((now + 3600))" ;;
  *) echo "LIMIT_HIT source=statusline restart_at=$((lim + 600))" ;;
esac
```
파일이 없거나 깨졌으면 `LIMIT_NONE` 이다. 한도를 모르는 것은 한도가 아닌 것으로 본다. 그 워커는 무응답 규칙으로
가고, 거듭 죽으면 재시도 상한에서 멈춘다.

## 재시작 후보를 띄울지

재시도 수는 SKILL.md 「팀장 상태」 고아 스캔 2번 블록의 `tries=` 로 잰다(공식을 바꾸지 않는다).

| 조건 | `team.lost` 의 `next` | 처리 |
|---|---|---|
| `tries` ≥ 3 | `park` | 「멈춤」(사유 `재시도 상한`). `team.result` 를 쓰지 않는다. 쓰면 다음 팀장 시작의 고아 스캔이 재시도 0 으로 읽고 또 재개한다 |
| 차단기가 걸렸거나 rate-limit 보류 중이고, 이번이 그 TICK 의 시험 1건이 아니다 | `wait`(`restart_at` 은 `-`) | 슬롯만 해제한다. 다음 기상에 `RESTART_DUE` 로 다시 본다. `next=wait` 인 `team.lost` 는 차단기 연속 실패 수에 넣지 않는다(미룬 것이지 새 실패가 아니다. 세면 대기 중인 손실이 차단기를 스스로 붙잡는다) |
| 그 밖 | `restart` | 같은 기상 안에서 「재투입」 |

차례(세 갈래 공통):
1. **거두기**를 먼저 한다. tmux 는 아래 블록이다. `REAPED <pane>` 이 나와야 다음으로 간다.
   ```bash
   TM='<진짜 tmux 절대경로>'; w='<워크트리>'; pane='<pane id>'
   [ -n "$TM" ] || { echo REAP_NO_TMUX; exit; }
   "$TM" -L dflow kill-pane -t "$pane" 2>/dev/null || :
   if [ "$("$TM" -L dflow display-message -p -t "$pane" '#{pane_id}' 2>/dev/null)" = "$pane" ]; then
     echo "REAP_FAILED $pane"
   else
     "$TM" -L dflow select-layout -t dflow tiled 2>/dev/null || :
     printf '%s\n' '<신원>/<host>/parked' > "$w/.dflow-agent" && echo "REAPED $pane"
   fi
   ```
   `REAPED` 는 kill 뒤 그 pane 을 다시 찾지 못했을 때만 나온다(pane 이 실제로 없어졌다는 확인). 종료 코드가 아니라
   출력한 pane id 로 가르는 이유: tmux 3.7 은 없는 pane id 에도 `display-message` 를 0 으로 끝내고 빈 값을 낸다(실측). `REAP_FAILED`(pane 이
   아직 있다)나 `REAP_NO_TMUX`(tmux 경로 없음)면 `team.lost` 를 쓰지 않고 재투입하지 않으며 「멈춤」(사유 `거두기 실패`)
   으로 보고한다. 이유: 살아 있는 팀원 옆에 같은 작업을 겹쳐 띄우면 한 워크트리를 두 세션이 고친다.
2. 그 다음 `team.lost` 를 기록한다(events.md 조각. `slot` 은 그 슬롯 번호, `worktree` 는 워크트리 절대경로).
   거두기를 기록보다 먼저 하는 이유: 기록 뒤 거두기 전에 컨텍스트가 끊기면 다음 기상이 `RESTART_DUE` 로 보고
   살아 있는 pane 옆에 같은 작업을 겹쳐 띄운다. 거두기 뒤 기록 전에 끊기면 고아 스캔이 평범한 재개로 잇는다.
3. `restart` 면 「재투입」, `wait` 면 슬롯 해제, `park` 면 「멈춤」 표와 「알림 한 줄」 의 상한 줄.

**워크트리를 지우지 않는다.** 깨끗하고 push 된 워크트리도 그대로 둔다. 지우면 5-1 이 원격 브랜치에서 다시 만들어야
하고 그 사이 미추적 `.issues` 를 잃는다. 이 절은 SKILL.md 「3. 결과 처리」 의 무응답 자동 정리(tmux 갈래)와
`failed no-result` 행의 "고아 정리 규칙을 따른다" 를 재시작 후보에 한해 대신한다.

## 재투입

SKILL.md 「5-1. 재개 spawn」 을 그대로 따르고 아래만 다르다.

**재투입 전 확인**(모든 재투입 — 같은 기상의 `restart`, `RESTART_DUE`, `RL_DUE` — 에서 거두기 뒤·띄우기 전에 한 번).
이번 기상의 `show` 로 서버가 `claimed`+`mine`+이 PC 인지, 워크트리의 `.dflow-pane` 이 가리키는 팀원이 살아 있지 않은지,
재시도 수가 3 미만인지를 다시 본다. 고아 스캔 "재개 가능" 조건과의 교집합이다. `REINJECT_OK` 가 아니면 띄우지 않고
「멈춤」(사유는 출력의 사유: `서버 조회 실패`·`서버 <status>`·`다른 PC claim`·`살아 있는 팀원`·`재시도 상한`)으로 보고한다.
```bash
w='<워크트리>'; id8='<id8>'; TM='<진짜 tmux 절대경로 또는 빈 값>'
g=$( (.claude/skills/dflow-work/scripts/dflow.sh show "$id8") 2>/dev/null \
  | jq -r --arg h 'claude-<host>' 'select((.order.id // "") != "") | .order
      | [.id, .status, (.mine == true | tostring), ((((.claimed_by // "") | ascii_downcase) as $c | $c == $h or (($c | split("/")) as $p | ($p | length) == 3 and $p[1] == ($h | ltrimstr("claude-")))) | tostring)] | join(" ")' 2>/dev/null )
t=$(jq -r --arg a '<신원>/<host>/lead' --arg r '<MAIN>' --arg i "$id8" \
  'select(.agent == $a and .repo == $r and (.id8 // "") == $i)
   | select(.event == "team.result" or (.event == "team.spawn" and (.spawn_kind // "new") == "resume"))
   | .event' ~/.dflow/events.jsonl 2>/dev/null \
  | awk '/team\.result/{n=0; next} {n++} END{print n+0}')
p=$(head -n 1 "$w/.dflow-pane" 2>/dev/null); live=no
if [ -n "$p" ]; then
  if [ -z "$TM" ]; then live=unknown
  elif [ "$("$TM" -L dflow display-message -p -t "$p" '#{pane_id} #{pane_dead}' 2>/dev/null)" = "$p 0" ]; then live=yes; fi
fi
o=$(printf '%s\n' "$g" | cut -d' ' -f1); st=$(printf '%s\n' "$g" | cut -d' ' -f2)
mi=$(printf '%s\n' "$g" | cut -d' ' -f3); hs=$(printf '%s\n' "$g" | cut -d' ' -f4)
if [ -z "$g" ]; then echo "REINJECT_BLOCKED show-failed"
elif [ "$st" != claimed ]; then echo "REINJECT_BLOCKED server $st"
elif [ "$mi" != true ] || [ "$hs" != true ]; then echo "REINJECT_BLOCKED other-claim"
elif [ "$live" != no ]; then echo "REINJECT_BLOCKED live-pane $p"
elif [ "${t:-0}" -ge 3 ]; then echo "REINJECT_BLOCKED tries=$t"
else echo "REINJECT_OK order=$o st=$st tries=$t"; fi
```
사유 대응: `show-failed` → `서버 조회 실패`, `server <status>` → `서버 <status>`, `other-claim` → `다른 PC claim`,
`live-pane` → `살아 있는 팀원`, `tries=` → `재시도 상한`. `live=unknown`(tmux 경로 없음)도 살아 있는 것으로 본다(fail-closed).

1. 1항의 손실 보고 한 줄은 「알림 한 줄」 의 재시작 줄로 바꾼다. 워크트리가 있으므로 "잃는 것" 은 늘 `없음` 이다.
2. 3항: 있는 워크트리를 그대로 쓴다.
3. 4항: 슬롯은 `.dflow-prompt` 의 `AGENT_ID` 번호다. 방금 거둬 비었으므로 대개 같은 번호이고, 이미 찼으면 발급
   규칙으로 새로 낸다.
4. 6항(띄우기) **직전**에 「중단 표식 정리」 블록을 돈다. `order`·`st` 는 **이번 기상의** 재투입 전 확인이 낸 `order=`·`st=`
   값만 쓴다(이벤트나 이전 기상의 값을 쓰지 않는다).
   `CANCEL_MARK_RM_FAILED` 면 띄우지 않고 「멈춤」(사유 `중단 표식 삭제 실패`)으로 보고한다.
5. claim 은 하지 않는다. 주문은 `claimed`·`mine` 이며(재투입 전 확인이 이번 기상에 확인했다), 이어받은 `/dflow-dev --worker` 가 재claim
   을 건너뛴다.
6. 8항의 `team.spawn` 은 `spawn_kind=resume` 이다. 재시도 수가 이 값으로 늘어난다. `team.lost` 는 이미 앞에서 기록했다.

## rate-limit 대기

생존 증거 요약(`evidence`)은 SKILL.md 「3. 결과 처리」 의 세 증거를 이은 cksum 이다.
```bash
w='<워크트리>'; id8='<id8>'
e1=$(git -C "$w" log -1 --format=%ct 2>/dev/null)
e2=$( (.claude/skills/dflow-work/scripts/dflow.sh show "$id8") 2>/dev/null \
  | jq -r '[([.reports[]?] | last | .created_at // "-"), (.order.last_heartbeat_at // "-"), (.order.heartbeat_phase // "-")] | join(",")' 2>/dev/null )
e3=$(git -C "$w" status --porcelain 2>/dev/null | cksum | cut -d' ' -f1)
printf 'evidence=%s\n' "$(printf '%s|%s|%s\n' "$e1" "${e2:-SHOW_FAILED}" "$e3" | cksum | cut -d' ' -f1)"
```
rate-limit 횟수는 **한도 에피소드** 안의 `cause=rate-limit` 인 `team.lost` 수다. 에피소드는 첫 rate-limit `team.lost`
(`next=wait`)부터 재개 성공까지이며, 마지막 `team.result` 나 `spawn_kind=readopt` 인 `team.spawn`(워커가 스스로 이어 감)에서
끊긴다. 그래서 워커가 스스로 이어 간 뒤 새 한도에 서면 새 에피소드라 다시 1회 재시작한다. 재투입(`resume`)은 끊지 않는다.
재투입한 워커가 곧바로 또 한도에 서면 같은 에피소드의 둘째라 「멈춤」(`rate-limit 반복`)이다. `team.start` 로 자르지 않는다.
```bash
id8='<id8>'
jq -r --arg a '<신원>/<host>/lead' --arg r '<MAIN>' --arg i "$id8" \
  'select(.agent == $a and .repo == $r and (.id8 // "") == $i)
   | select(.event == "team.result" or (.event == "team.spawn" and .spawn_kind == "readopt") or (.event == "team.lost" and .cause == "rate-limit"))
   | .event' ~/.dflow/events.jsonl 2>/dev/null \
  | awk '/team\.(result|spawn)/{n=0; next} {n++} END{print "rl=" n+0}'
```

| 때 | 처리 |
|---|---|
| 감지(「판정」 5번) | 위 블록으로 `evidence` 를 잰다. `team.lost`(`cause=rate-limit`, `next=wait`, `restart_at`=「한도 판정」 값, `evidence`)를 기록한다. **pane 이 살아 있으면 죽이지 않고 슬롯을 그대로 쥔다**(자동 이어 가기를 없애지 않는다). pane 이 죽어 있으면 거두기 블록을 돌고 감시 루프의 `set --` 에서 뺀다. 보류가 시작된다. 「알림 한 줄」 의 rate-limit 줄 |
| `RL_WAIT` 인 기상 | 그 슬롯은 무응답 판정에서 뺀다. `PANE_DEAD` 로 와도 거두기만 하고 `restart_at` 까지 기다린다 |
| `RL_DUE` 이고 pane 이 살아 있음 | `evidence` 를 다시 잰다. **이벤트의 `evidence` 와 다르면** 워커가 스스로 이어 간 것이다. `team.spawn`(`spawn_kind=readopt`, 같은 `slot`·`worktree`·`handle`)으로 진행 중에 되돌린다. `readopt` 는 재시도로 세지 않는다. **같으면** 아래 "재투입 판정" |
| `RL_DUE` 이고 pane 이 죽었거나 `.dflow-agent` 가 `parked` | 증거를 재지 않고 곧바로 "재투입 판정". 자동 이어 가기가 없다 |
| 재투입 판정 | `rl` ≥ 2 면 거두기 → `team.lost`(`cause=rate-limit`, `next=park`) → 「멈춤」(사유 `rate-limit 반복`). `tries` ≥ 3 이면 같은 차례로 사유 `재시도 상한`. 그 밖이면 거두기 → 「재투입」(차단기가 걸렸으면 그 TICK 의 시험 1건으로만). 이때 `team.lost` 를 새로 쓰지 않는다(감지 때 이미 썼다. 다시 쓰면 `rl` 이 부풀어 한 번 만에 멈춘다) |
| 보류 해제 | `RL_WAIT`·`RL_DUE` 가 모두 없어지면 보류가 풀린다. SKILL.md 「2-1」 재기동 조건을 다시 본다 |

## 중단 표식 정리

heartbeat 훅은 `~/.dflow/hb/<주문>.cancelled` 가 있으면 첫 도구 호출에서 세션을 세운다. 훅은 표식을 지우지 않으므로
팀장이 **모든 spawn(새 작업·재개·재시작) 직전**에 지운다. 조건은 그 기상에서 이미 받은 `show` 의 `.order.status` 가
`ready`(새 작업) 또는 `claimed`(재개·재시작)인 것이다. 서버가 살아 있다고 말하는 주문의 표식은 낡은 것이다(스테이징·
운영 UUID 가 겹친 경우가 대표적이다). `show` 를 받지 못했으면 spawn 자체를 하지 않는다.
```bash
order='<주문 전체 UUID>'; st='<show 의 .order.status>'
case "$st" in
  ready|claimed)
    m="$HOME/.dflow/hb/$order.cancelled"
    if [ -e "$m" ]; then
      rm -f "$m" 2>/dev/null
      if [ -e "$m" ]; then echo "CANCEL_MARK_RM_FAILED $order"; else echo "STALE_CANCEL_MARK_REMOVED $order"; fi
    fi ;;
esac
```
- `STALE_CANCEL_MARK_REMOVED` 가 나오면 보고에 한 줄 적는다.
- `CANCEL_MARK_RM_FAILED` 면 **띄우지 않는다.** 띄우면 첫 도구 호출에서 선다.
- 워크트리 `state.json` 이 `cancelled` 인 경우는 여기서 고치지 않는다(「판정」 4번이 「멈춤」 으로 보낸다).
- 수동 `/dflow-dev` 세션의 표식은 사람이 지운다.

## Orca

Orca 는 **재투입하지 않는다**(실측 관문 전). 관문은 셋이다: `orca terminal close --terminal <핸들>` 이 팀원 claude 를
실제로 끝내는가, `orca terminal create --worktree path:<워크트리> --command './.dflow-run' --json` 으로 띄운 세션이
권한 확인 생략 모드로 돌고 포인터가 첫 입력으로 들어가며 폴더 신뢰 확인을 넘기는가, 새 탭의 핸들을 JSON 으로
받는가. 셋을 확인하기 전에는 이 명령들을 실행 절차에 쓰지 않는다.
관문 전 Orca 는 「판정」 의 1~4번과 9번까지만 하고, (나) 2회째 무응답이면 SKILL.md 「3. 결과 처리」 의 Orca 무응답
처리를 그대로 한 뒤 한 줄을 더한다: `<TSK> <id8> 재시작하려면 그 탭을 닫고 /dflow-team <종료시각> --resume <id8>`.
**`team.lost` 는 기록하지 않는다.** 관문 전 동작은 현행과 같아야 하기 때문이다.

## 마감·lease·잠금

| 상황 | 동작 |
|---|---|
| `LEASE_LOST` 기상 | 판정하지 않는다. 떠 있는 워커는 건드리지 않는다. 대기 중인 재시작은 버린다(같은 체크아웃의 다음 팀장이 고아 스캔으로 잇는다) |
| `LOCK_LOST` | 판정하지 않는다. 재시작하지 않는다 |
| `STALE` 기상 | 판정하지 않는다 |
| 한 기상 안에서 거두기 뒤 lease 상실 | 재투입은 거두기와 같은 기상 안에서 끝낸다. 방금 띄운 워커는 "하던 작업을 끝낸다" 규칙에 들어간다 |
| 「7. 마감」 | 재시작하지 않는다. `RESTART_DUE`·`RL_WAIT`·`RL_DUE` 는 「멈춤」 표에 사유(`무응답`·`pane 죽음`·`rate-limit 대기(<HH:MM>)`)와 재시작 명령 `/dflow-team <종료시각> --resume <id8>` 을 적는다 |
| 다른 clone·다른 PC 의 새 팀장 | 이벤트는 `agent`+`repo` 단위라 넘어가지 않는다. 새 팀장은 「멈춤」(사유 `워크트리 없음`)으로 올리고, 복구는 사람의 `--resume` 이다 |

## 알림 한 줄

| 분류 | 한 줄 |
|---|---|
| 재시작 | `<TSK> <id8> 재시작(<무응답|pane 죽음|rate-limit>, <tries+1>/3) — 워크트리 <경로> 이어받음` |
| rate-limit 대기 | `<TSK> <id8> 사용량 한도 — <HH:MM> 이후 다시 봅니다. 그때까지 새 배정 보류` |
| 상한·반복 | `<TSK> <id8> 멈춤(<재시도 상한|rate-limit 반복>) — 재시작 명령: /dflow-team <종료시각> --resume <id8>` |
| 표식 정리 | `<TSK> <id8> 낡은 중단 표식을 지웠다(STALE_CANCEL_MARK_REMOVED)` |
| 그 밖 멈춤 | SKILL.md 「팀장 상태」 의 「멈춤」 표에 사유를 적는다 |
