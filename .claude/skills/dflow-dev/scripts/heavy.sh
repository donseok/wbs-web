#!/usr/bin/env bash
# 무거운 명령 줄 세우기 — PC 전역 세마포어. 규칙 정본: ../references/dev-discipline.md 「무거운 명령 줄 세우기」.
#
# 전체 테스트·빌드·E2E 서버처럼 메모리를 크게 쓰는 명령을 PC 전체에서 동시에 K개까지만 돌린다. 리포가 달라도
# 같은 PC 면 같은 슬롯을 나눠 쓴다(2026-09-24 dmes-standard: 팀원 6명이 testAll·Testcontainers·E2E 서버를 동시에
# 돌려 load 52, 스왑 17GB/18GB). flock 은 macOS 에 없으므로 mkdir 의 원자성으로 슬롯을 잡는다(Git Bash 도 같다).
#
# 사용법
#   heavy.sh <명령> [인자…]   슬롯을 얻어 명령을 돌린다. 끝나거나 중단(INT·TERM·HUP)되면 슬롯을 푼다. exit 는 명령의 것.
#   heavy.sh acquire <이름>   세션이 **E2E 풀** 슬롯 하나(e2e-<i>)를 붙잡는다(E2E 서버를 띄우기 직전). 소유자는 이 세션
#                             (아래 OWNER). E2E 풀은 일반 슬롯과 따로라 E2E 서버가 떠 있어도 게이트가 굶지 않는다.
#                             DFLOW_HEAVY_E2E_SLOTS=0 이면 옛 동작대로 일반 슬롯을 붙잡는다.
#                             같은 세션의 이후 `heavy.sh <명령>` 은 이 슬롯을 다시 쓴다(HEAVY_REUSE — 두 번째 슬롯을 기다리지
#                             않는다). `--pool docker` 는 도커 슬롯만 더 잡는다.
#   heavy.sh release          이 세션이 붙잡은 슬롯(E2E 풀·일반)을 푼다(서버를 끈 직후).
#   heavy.sh status           stdout 에 정확히 한 줄 `HEAVY_STATUS slots=<K> held=<N> waiting=<M>` 을 내고 exit 0.
#                             held = 살아 있는 일반 슬롯 보유 수, waiting = 일반 슬롯을 기다리는 heavy.sh 수(아래 대기 표식).
#                             E2E 풀은 세지 않는다. 이 줄은 기계가 읽는다(dflow-team capacity.sh) — 형식을 바꾸지 않는다.
#                             사람이 볼 세부(ram·dir·보유 명령, `HEAVY_DOCKER docker=<n> held=<n> waiting=<n> <보유>`,
#                             `HEAVY_E2E e2e=<n> held=<n> waiting=<n> <보유>`, 독점 대기가 있으면 `HEAVY_EXCL <표식>`)는 stderr 로 낸다.
#   heavy.sh snapshot         팀장 lease 갱신(dflow-lease.sh)이 읽는 기계 출력. stdout 에 탭 구분 줄, 늘 exit 0:
#                               PC	<K>	<held>	<waiting>	<load1|->	<cpus|->
#                               RUN	<start>	<kind run|hold>	<pool general|docker>	<cwd>	<cmd>   살아 있는 보유(pid 로 한 줄)
#                               WAIT	<start>	<pool general|docker>	<cwd>	<cmd>              살아 있는 대기 표식
#                             앱(heavyWork.ts)은 pool ∈ {general, docker}, kind ∈ {run, hold} 만 받는다. 그래서 E2E 풀 보유는
#                             `RUN … hold general …`, E2E 풀 대기는 `WAIT … general …`, 독점 실행(K개)은 `RUN … run general …`
#                             한 줄로 낸다. PC 줄의 held·waiting 은 HEAVY_STATUS 와 같이 일반 풀만 센다.
#                             cwd 로 팀원 워크트리(dflow-<id8>)를 알아본다. 설계 wbs-web 리포 docs/superpowers/specs/2026-09-26-heavy-work-office-bubble-design.md(킷에는 미동봉)
#   heavy.sh --pool docker <명령> [인자…]
#                             도커를 쓰는 명령(Testcontainers·docker compose·방언 검증). PC 전역 **도커 슬롯**(기본 1개)과
#                             일반 슬롯 하나를 **함께** 잡는다. 도커 명령도 무거운 명령이라 일반 슬롯 수(K)에 들어가야
#                             PC 전체 동시 실행이 K 를 넘지 않는다. 이 세션이 이미 일반·E2E 슬롯을 쥐고 있으면(acquire·감싼
#                             실행 안) 도커 슬롯만 잡는다.
#   heavy.sh --exclusive <명령> [인자…]
#                             독점 실행 — 벽시계 성능 테스트처럼 다른 무거운 명령과 겹치면 안 되는 명령. 일반 슬롯 K개를
#                             **한꺼번에** 잡는다(하나라도 못 잡으면 잡은 것을 모두 돌려주고 다시 시도 — 쥐고 기다리지 않는다).
#                             기다리는 동안 양보 표식 <DIR>/excl-<소유 PID>-<heavy.sh PID> 를 두어 다른 세션의 새 일반 take 를
#                             멈춘다(아래).
#                             이미 슬롯을 쥔 세션(acquire·감싼 실행 안)에서 부르면 HEAVY_EXCL_NESTED 와 exit 2 로 거부한다(이
#                             세션의 재호출 대기 표식도 지운다). 살아 있는 일반 슬롯 hold(E2E 풀을 끈 acquire·옛 heavy.sh 의
#                             acquire)가 있으면 기다려도 K개를 못 모으므로 표식 없이 곧바로
#                             `HEAVY_BUSY k=<K> wait=<초>s 독점 불가: E2E hold 보유 중 <보유>` 와 exit 75 로 돌아온다.
#                             `--pool docker` 와 함께 쓰지 않는다. E2E 풀 보유자는 막지 않는다(일반 풀만 독점한다).
#   heavy.sh --detach [--pool docker|--exclusive] <명령> [인자…]
#                             분리 실행 — 한 번에 10분을 넘는 명령용. 잡 폴더 <JOBS>/<id>/ 에 cmd·cwd·start·log·pid·pstart 를
#                             쓰고, nohup 으로 띄운 자식이 `heavy.sh [--pool docker|--exclusive] <명령>` 을 돈다(슬롯 소유자는
#                             그 자식, 슬롯 대기 상한은 DFLOW_HEAVY_DETACH_WAIT). 끝나면 rc 를 임시 파일→mv 로 원자적으로 쓴다.
#                             그 자식은 세션의 E2E hold 를 다시 쓰지 않는다(REUSE 끔 — 자기 슬롯을 잡는다). 명령을 돌리는 손자
#                             heavy.sh 의 pid 도 잡 폴더(runpid·runpstart)에 적어, 잡만 죽고 손자가 살아 있으면 wait 가 RUNNING 으로 본다.
#                             곧바로 stdout 에 `HEAVY_DETACHED id=<id> pid=<pid> log=<경로>` 를 내고 exit 0.
#   heavy.sh wait <id> [--max <초>]
#                             분리 실행을 최대 <초>(기본 240, 상한 240 — heartbeat) 기다린다. 끝났으면 stdout 에 로그 끝 30줄과
#                             `HEAVY_JOB_DONE id=<id> rc=<rc>` 를 내고 명령의 rc 로 끝난다. 단 잡 rc 가 75 면 `HEAVY_JOB_BUSY` 와
#                             exit 77(다시 --detach 한다), 76 이면 `HEAVY_JOB_FAILED` 와 exit 78(BUSY·RUNNING 규약과 겹치지 않게). 아직이면
#                             `HEAVY_JOB_RUNNING id=<id> elapsed=<초>s` 와 exit 76 — 실패가 아니며 같은 명령을 다시 부른다.
#                             rc 없이 자식이 사라졌으면(SIGKILL 등) 로그 끝 30줄과 `HEAVY_JOB_LOST id=<id> pid=<pid>`, exit 1.
#                             모르는 id 는 HEAVY_JOB_UNKNOWN 과 exit 2.
#
# 교착을 피하는 규칙(불변식): **도커 슬롯을 쥔 쪽은 아무것도 기다리지 않는다.** 도커 슬롯은 늘 마지막에, 필요한
# 슬롯을 한 번에 모두 잡는다 — 도커 슬롯을 잡았는데 일반 슬롯이 없으면 그 자리에서 도커 슬롯을 돌려주고 다음 시도로
# 간다(쥐고 기다리지 않는다). 그래서 "일반 슬롯을 쥐고 도커를 기다리는 쪽" 과 "도커를 쥐고 일반을 기다리는 쪽" 이 서로를
# 막는 순환이 생기지 않는다. 일반 슬롯을 쥔 채 도커 슬롯을 기다리는 쪽은 있을 수 있지만, 도커 슬롯 보유자는 이미 필요한
# 것을 다 가진 채 돌고 있으므로 끝나면 풀린다. 감싼 실행 안의 acquire 도 새 슬롯을 기다리지 않는다(아래 cmd_acquire).
# 독점 실행도 같은 규칙이다: 기다리는 동안 아무 슬롯도 쥐지 않고(전부 아니면 없음), 슬롯을 쥔 세션은 독점을 부르지 못한다.
#
# 부하 검사: **새 일반 슬롯**을 줄 때 1분 부하 평균이 코어 수 × DFLOW_HEAVY_LOAD_MAX(기본 1.5)를 넘으면 배정을 미룬다
# (2026-09-26 dmes-standard 성능 감사 P12: 슬롯 수 K 는 RAM 기준이라 게이트가 몰리면 부하 20~30, 최대 62 까지 올라 벽시계
# 성능 테스트가 실패해 blocked 가 났다). 미루는 것도 같은 대기 상한(DFLOW_HEAVY_WAIT)과 HEAVY_BUSY(exit 75) 규약 안에서 한다
# — 대기 중에는 stderr 에 `HEAVY_LOAD_WAIT load=<l>>cap=<c> …` 를 한 번 내고, HEAVY_WAIT·HEAVY_BUSY 줄 끝에 ` 부하 대기: load=<l>>cap=<c>`
# 를 붙인다(HEAVY_STATUS·snapshot 형식은 그대로다).
#   - 적용: 명령 실행(heavy.sh <명령>), 도커 풀의 일반 슬롯(도커 슬롯을 잡기 **전에** 본다 — 도커 슬롯을 쥔 채 부하를 기다리지
#     않는다, 교착 불변식), E2E 풀을 끈 acquire(일반 슬롯 hold).
#   - 적용하지 않음: 이미 쥔 슬롯(빼앗지 않는다), REUSE·감싼 실행 안(새 슬롯이 아니다), 도커 슬롯만 더 잡는 호출(일반·E2E 슬롯을
#     이미 쥠), E2E 풀(acquire — 기본 한 자리라 기아 방지를 두면 늘 통과하고, 두지 않으면 부하가 이어지는 동안 E2E 가 영영 서지
#     못한다. 서버가 뜬 뒤의 시험 명령은 REUSE 다), 독점 실행(K개를 모두 쥐므로 다른 heavy.sh 명령과는 이미 겹치지 않는다. 부하를
#     기다리게 하면 양보 표식이 새 take 를 막은 채 heavy.sh 밖의 부하(LLM 세션·E2E 서버)가 내려가기를 기다려 PC 전체가 선다).
#   - 기아 방지: 살아 있는 일반 풀 **실행**(kind=run) 보유자가 0명이면 부하와 무관하게 준다(적어도 하나는 돈다). hold 는 세지
#     않는다 — 한 시간씩 떠 있는 E2E hold(E2E 풀을 끈 acquire)가 있다고 부하가 높은 동안 게이트를 계속 미루지 않게.
#   - 부하 평균·코어 수는 snapshot 과 같은 방식으로 읽는다(macOS sysctl vm.loadavg, Linux /proc/loadavg · getconf/nproc).
#     못 읽으면(Windows Git Bash 등) 검사를 건너뛴다(fail-open — 성능 보호이지 보안 가드가 아니다).
#
# 슬롯을 DFLOW_HEAVY_WAIT 초(기본 90) 안에 못 얻으면 명령을 돌리지 않고 stderr 에
#   HEAVY_BUSY k=<K> wait=<초>s 보유: [slot-1 pid=… 12분 run] <명령> | …
# 한 줄을 내고 exit 75(EX_TEMPFAIL)로 끝난다(E2E 풀 acquire 는 `HEAVY_BUSY e2e=<n> wait=…`). 실패가 아니다 — 같은 명령을
# 다시 호출한다. 대기 상한이 있는 이유: 워커의 heartbeat 는 도구 호출 때 훅이 보내므로 Bash 한 번으로 오래 기다리면
# 팀장이 무응답(약 5분)으로 오판한다. 90초면 Bash 기본 timeout(120초) 안에서 돌아온다. 슬롯을 얻은 뒤의 명령 실행
# 시간에는 상한이 없다(10분을 넘을 명령은 --detach 로 돌린다).
#
# 환경변수
#   DFLOW_HEAVY_SLOTS    K. 기본 max(1, floor(RAM_GB/8)) — 16GB 면 2. RAM 을 못 읽으면 2.
#   DFLOW_HEAVY_DOCKER_SLOTS  도커 슬롯 수. 기본 1(같은 목적의 컨테이너를 PC 에서 하나만 띄운다).
#   DFLOW_HEAVY_E2E_SLOTS     E2E 풀 슬롯 수. 기본 1. 0 이면 E2E 풀을 끄고 acquire 가 일반 슬롯을 쓴다(옛 동작).
#                        대가: 켜 두면 PC 전체 동시 무거운 스택이 최대 K+E2E 슬롯 수가 된다(메모리가 빠듯하면 0).
#   DFLOW_HEAVY_DIR      슬롯 폴더. 기본 ~/.dflow/locks/heavy (시험은 임시 폴더로 바꾼다)
#   DFLOW_HEAVY_WAIT     슬롯 대기 상한(초). 기본 90. baseline.sh 는 자기 공유 마감까지 남은 시간(최소 5초)을 넘긴다
#                        — 앞선 대기와 겹쳐 Bash 한 번이 10분 상한에 닿지 않게.
#   DFLOW_HEAVY_POLL     재시도 간격(초). 기본 2
#   DFLOW_HEAVY_HOLD_TTL acquire 슬롯의 최대 보유(초). 기본 3600. 넘으면 버려진 것으로 보고 회수한다
#                        (release 를 잊은 세션이 몇 시간씩 슬롯을 막지 않게).
#   DFLOW_HEAVY_EXCL_TTL 재호출 사이 독점 양보 표식의 수명(초). 기본 180(= 기본 대기 상한 90초 × 2). 독점 호출이 HEAVY_BUSY 로
#                        돌아온 뒤 이만큼 다시 부르지 않으면 무시·회수한다(아래 「독점 양보 표식」). 읽는 쪽의 WAIT 로 셈하지
#                        않는다 — 분리 실행 자식(WAIT=3600)이나 baseline.sh(WAIT 몇 초)가 같은 표식을 서로 다르게 보지 않게.
#   DFLOW_HEAVY_JOBS     분리 실행 잡 폴더. 기본 ~/.dflow/jobs (잠금 폴더 밖·워크트리 밖). 끝난 지 7일 지난 잡은 지운다.
#   DFLOW_HEAVY_DETACH_WAIT  분리 실행 자식의 슬롯 대기 상한(초). 기본 3600. 넘으면 잡이 rc=75 로 끝난다(다시 --detach).
#   DFLOW_HEAVY_OWNER    acquire·release·독점 표식의 소유 PID. 기본 CLAUDE_PID, 없으면 PPID.
#   DFLOW_HEAVY_LOAD_MAX 부하 검사의 코어당 상한(소수 가능). 기본 1.5 — 10코어면 1분 부하 15 를 넘을 때 새 일반 슬롯을 미룬다.
#                        0 이면 검사를 끈다.
#   DFLOW_HEAVY_LOADAVG · DFLOW_HEAVY_CPUS  시험용 덮어쓰기 — 1분 부하 평균·코어 수를 이 값으로 본다(snapshot 의 PC 줄도).
#                        숫자가 아니면(예 `-`) 못 읽은 것으로 보아 부하 검사를 건너뛴다.
#
# 슬롯 = <DIR>/slot-<i> 폴더(1..K), 도커 슬롯 = <DIR>/docker-<i>, E2E 풀 = <DIR>/e2e-<i> 폴더. 안의 owner 파일에
# pid·kind(run|hold)·start(epoch)·pstart(ps lstart)·host·cwd·cmd. 소유 PID 가 죽었거나(kill -0 실패, 또는 lstart 가 달라
# PID 가 재사용됨) hold 의 TTL 이 지났으면 회수한다. 회수는 <DIR>/<슬롯>.reclaim mkdir 뮤텍스 안에서 owner 를 다시 읽고
# 확인한 뒤에만 지운다. E2E 풀도 같은 규칙이다.
#
# 대기 표식: 슬롯을 기다리는 동안 <DIR>/wait-<pid>(pid = 기다리는 heavy.sh 자신의 $$) 파일을 둔다. 안에 pid·pool
# (general|docker|e2e)·start·pstart·cwd·cmd. 슬롯을 얻거나, 포기하거나(BUSY), 신호로 끝나면 지운다(trap). SIGKILL 처럼 지우지
# 못하고 죽은 표식은 status 가 소유 PID 생존(+ lstart)을 확인해 무시하고 지운다.
#
# 독점 양보 표식: <DIR>/excl-<소유 PID>-<heavy.sh PID> 파일(pid·pstart·hpid·hpstart·start·seen·cwd·cmd). 호출마다 이름이
# 달라 같은 세션의 독점 둘이 한 파일을 나눠 쓰지 않는다. 자기 세션 것인지는 파일 이름이 아니라 pid(소유 PID) 필드로 가린다.
# 표식의 상태는 셋이다.
#   active — 기다리거나 도는 독점 heavy.sh(hpid, + lstart)가 살아 있다. seen 과 무관하다(도는 동안은 seen 을 새로 쓰지 않는다).
#   gap    — HEAVY_BUSY 로 돌아와 다시 부르기를 기다리는 중(hpid=-). seen 이 DFLOW_HEAVY_EXCL_TTL(기본 180초) 안이면 살아 있다.
#   dead   — 소유 PID 가 죽었거나, hpid 프로세스가 사라졌거나(SIGKILL 등 — 곧바로 무시), gap 인데 TTL 이 지났다. 무시·회수한다.
# active·gap 표식이 있으면 **다른 세션**의 새 일반 take(명령 실행·E2E 풀을 끈 acquire·도커 풀의 일반 슬롯)는 슬롯을 잡지
# 않는다 — 지금 도는 명령이 끝나면 슬롯이 비어 독점 실행이 K개를 한꺼번에 잡는다. 독점끼리는 start 순서로 줄을 서되,
# 앞선 **active** 표식만 기다린다(재호출 사이의 선두는 앞지른다 — 그동안 기다리는 독점이 있으면 PC 가 놀지 않게).
# 기준을 둘로 나눈 이유: 일반 take 는 gap 에도 양보해야 독점 대기자가 BUSY 를 받고 다시 부르는 수십 초 사이에 비운 슬롯을
# 남에게 뺏기지 않는다(드레인). 그 공백은 에이전트 재호출 시간이라 기본 대기 90초의 2배(180초)면 넉넉하고, 더 부르지 않은
# 세션도 최대 180초 뒤에는 PC 를 풀어 준다. 반면 기다리는 주인이 없다는 사실(hpid=-·hpid 죽음)은 곧바로 알 수 있으므로,
# 줄 순서·강제 종료 판정은 시간이 아니라 프로세스 생존으로 한다.
# 재호출은 이 세션의 gap 표식을 원자적 mv 로 이어받아 start(순번)를 지킨다. 독점 실행이 끝나거나 중단되면, 그리고 NESTED 로
# 거부하거나 일반 hold 때문에 독점 불가로 돌아올 때와 acquire 가 슬롯을 붙잡을 때 이 세션의 gap 표식을 지운다.
# hpid 필드가 없는 표식(이 규칙 이전의 새 heavy.sh)은 seen 이 15초 안이면 active, TTL 안이면 gap 으로 본다.
# 회수는 표식을 .xdel.* 로 옮긴 뒤 다시 확인하고 지운다(그 사이 주인이 새로 쓴 표식을 지우지 않게).
#
# 옛 heavy.sh 와의 공존: 같은 잠금 폴더를 옛 프로세스가 함께 쓸 수 있다. 옛 코드는 slot-<i>·docker-<i>(번호로)와 wait-* 만
# 보므로 e2e-*·excl-*·.xtmp.*·.xdel.* 는 모른 채 무시한다(지우거나 세지 않는다). 그래서 전환기에는 옛 프로세스가 독점 표식에
# 양보하지 않고, 옛 release 는 E2E 풀을 풀지 못한다(세션이 끝나거나 TTL 이 지나면 회수된다). 잡 폴더는 잠금 폴더 밖이다.
#
# 출력(stderr): HEAVY_WAIT · HEAVY_LOAD_WAIT · HEAVY_SLOT · HEAVY_REUSE · HEAVY_RECLAIM · HEAVY_BUSY · HEAVY_ACQUIRED · HEAVY_RELEASED
#   도커 풀은 HEAVY_DOCKER_WAIT · HEAVY_DOCKER_SLOT · HEAVY_DOCKER_BUSY(exit 75, 일반 풀의 HEAVY_BUSY 와 같은 규약)
#   독점은 HEAVY_EXCL_WAIT · HEAVY_EXCL · HEAVY_BUSY(exit 75) · HEAVY_EXCL_NESTED(exit 2)
# 출력(stdout): 분리 실행의 HEAVY_DETACHED · HEAVY_JOB_DONE · HEAVY_JOB_BUSY · HEAVY_JOB_FAILED · HEAVY_JOB_RUNNING · HEAVY_JOB_LOST (와 로그 끝)
# 도커 풀 실행은 DFLOW_HEAVY_DOCKER_HELD 에 도커 슬롯 경로를 export 한다(안쪽 --pool docker 호출은 기다리지 않는다).
set -u

DIR="${DFLOW_HEAVY_DIR:-$HOME/.dflow/locks/heavy}"
WAIT="${DFLOW_HEAVY_WAIT:-90}"
POLL="${DFLOW_HEAVY_POLL:-2}"
HOLD_TTL="${DFLOW_HEAVY_HOLD_TTL:-3600}"
# 재호출 사이 독점 표식의 수명(머리 주석 「독점 양보 표식」). 읽는 쪽의 WAIT 에서 셈하지 않고 고정 기본값을 쓴다.
EXCL_TTL="${DFLOW_HEAVY_EXCL_TTL:-180}"
case "$EXCL_TTL" in ''|*[!0-9]*) EXCL_TTL=180 ;; esac
# hpid 필드가 없는 표식(이 규칙 이전)을 active 로 볼 seen 창(초). 그 코드는 기다리는 동안 POLL 마다 seen 을 새로 쓴다.
EXCL_OLD_ACTIVE=15
JOBS="${DFLOW_HEAVY_JOBS:-$HOME/.dflow/jobs}"
DETACH_WAIT="${DFLOW_HEAVY_DETACH_WAIT:-3600}"
case "$DETACH_WAIT" in ''|*[!0-9]*) DETACH_WAIT=3600 ;; esac
BUSY_RC=75
RUNNING_RC=76
JOB_WAIT_MAX=240
# wait 가 잡 rc 75·76 을 옮겨 내는 exit(BUSY_RC·RUNNING_RC 와 겹치지 않게)
JOB_BUSY_RC=77
JOB_RC76_RC=78
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

ram_gb() {
  local b kb
  b=$(sysctl -n hw.memsize 2>/dev/null) || b=
  case "$b" in ''|*[!0-9]*) ;; *) echo $(( (b + 536870912) / 1073741824 )); return 0 ;; esac
  kb=$(awk '/^MemTotal:/{print $2; exit}' /proc/meminfo 2>/dev/null) || kb=
  case "$kb" in ''|*[!0-9]*) ;; *) echo $(( (kb + 524288) / 1048576 )); return 0 ;; esac
  return 1
}

slots() {
  local k="${DFLOW_HEAVY_SLOTS:-}" g
  case "$k" in
    ''|*[!0-9]*|0) if g=$(ram_gb); then k=$(( g / 8 )); [ "$k" -ge 1 ] || k=1; else k=2; fi ;;
  esac
  echo "$k"
}

K=$(slots)
KD="${DFLOW_HEAVY_DOCKER_SLOTS:-1}"
case "$KD" in ''|*[!0-9]*|0) KD=1 ;; esac
# E2E 풀은 0 을 받는다(끔 = 옛 동작). 도커 풀처럼 0 을 1 로 바꾸지 않는다.
KE="${DFLOW_HEAVY_E2E_SLOTS:-1}"
case "$KE" in ''|*[!0-9]*) KE=1 ;; esac
# 부하 검사의 코어당 상한(머리 주석). 0 은 끔. 숫자가 아니면 기본값
LOAD_MAX="${DFLOW_HEAVY_LOAD_MAX:-1.5}"
case "$LOAD_MAX" in ''|.|*[!0-9.]*|*.*.*) LOAD_MAX=1.5 ;; esac
now() { date +%s; }
# 1분 부하 평균·코어 수. snapshot 과 부하 검사가 함께 쓴다. 못 읽으면 1(빈 출력). 덮어쓰기는 머리 주석의 시험용 변수.
load1() {
  local l
  if [ -n "${DFLOW_HEAVY_LOADAVG:-}" ]; then
    l="$DFLOW_HEAVY_LOADAVG"
  else
    l=$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')
    [ -n "$l" ] || l=$(awk '{print $1}' /proc/loadavg 2>/dev/null)
  fi
  case "$l" in ''|.|*[!0-9.]*|*.*.*) return 1 ;; esac
  echo "$l"
}
ncpus() {
  local c
  if [ -n "${DFLOW_HEAVY_CPUS:-}" ]; then
    c="$DFLOW_HEAVY_CPUS"
  else
    c=$(getconf _NPROCESSORS_ONLN 2>/dev/null) || c=
    case "$c" in ''|*[!0-9]*) c=$(nproc 2>/dev/null) || c= ;; esac
  fi
  case "$c" in ''|*[!0-9]*|0) return 1 ;; esac
  echo "$c"
}
# 1..n. macOS 의 `seq 1 0` 은 "1 0" 을 내므로 n=0 이면 아무것도 내지 않는다.
nums() { [ "$1" -ge 1 ] 2>/dev/null && seq 1 "$1"; return 0; }
# 시작 시각은 로캘을 고정해 읽는다. 세션마다 LANG·LC_TIME 이 달라도 같은 문자열이 나와야 살아 있는 소유자를
# PID 재사용으로 오판하지 않는다. Git Bash 의 ps 는 -o 를 모르므로 빈 값(= 확인 생략)이 된다.
pstart() { LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//;s/ *$//'; }
# PID 생존 확인. Windows(Git Bash/MSYS)는 CLAUDE_PID 가 네이티브 Windows PID 라 kill -0 이 못 알아본다 —
# 살아 있는 hold 를 죽은 것으로 보고 회수하지 않도록 `ps -W` 의 WINPID 열에서 한 번 더 찾는다(dflow-lease.sh 와 같은 방식).
alive() {
  kill -0 "$1" 2>/dev/null && return 0
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*)
      ps -W 2>/dev/null | awk -v pid="$1" '
        NR==1 { for (i=1;i<=NF;i++) if ($i=="WINPID") c=i; next }
        c && $c==pid { found=1 }
        END { exit !found }' ;;
    *) return 1 ;;
  esac
}
field() { sed -n "s/^$2=//p" "$1/owner" 2>/dev/null | head -n 1; }
owner_pid() { echo "${DFLOW_HEAVY_OWNER:-${CLAUDE_PID:-$PPID}}"; }
usage() {
  echo "사용법: heavy.sh [--pool docker | --exclusive] [--detach] <명령> [인자…] | acquire <이름> | release | status | snapshot | wait <id> [--max <초>]" >&2
  exit 2
}

# 대기 표식(머리 주석). 임시 파일은 wait-* 패턴 밖(.wtmp.*)에 써서 status 가 반쯤 쓴 표식을 세지 않게 한다.
WAITF=
wait_mark() { # $1 pool $2 cmd
  local t="$DIR/.wtmp.$$" p c
  [ -z "$WAITF" ] || return 0
  p=$(pstart "$$"); c=$(printf '%s' "$2" | tr '\n' ' ')
  if { echo "pid=$$"; echo "pool=$1"; echo "start=$(now)"; echo "pstart=${p:--}"; echo "cwd=$PWD"; echo "cmd=$c"; } > "$t" 2>/dev/null &&
    mv -f "$t" "$DIR/wait-$$" 2>/dev/null; then
    WAITF="$DIR/wait-$$"
  else
    rm -f "$t" 2>/dev/null
  fi
  return 0
}
wait_unmark() { [ -z "$WAITF" ] || rm -f "$WAITF" 2>/dev/null; WAITF=; }
wfield() { sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1; }
# 표식의 주인이 죽었으면 0(무시·청소 대상). pid 를 못 읽으면 쓰는 중일 수 있어 1분 넘었을 때만 죽은 것으로 본다.
wait_dead() {
  local f="$1" pid ps0 ps1
  pid=$(wfield "$f" pid)
  case "$pid" in ''|*[!0-9]*) [ -n "$(find "$f" -maxdepth 0 -mmin +1 2>/dev/null)" ]; return ;; esac
  alive "$pid" || return 0
  ps0=$(wfield "$f" pstart)
  if [ -n "$ps0" ] && [ "$ps0" != "-" ]; then
    ps1=$(pstart "$pid")
    [ -z "$ps1" ] || [ "$ps1" = "$ps0" ] || return 0   # PID 재사용
  fi
  return 1
}
# $1 pool(general|docker|e2e) — 살아 있는 대기 표식 수. 죽은 표식은 지운다
count_waiting() {
  local f n=0 pool
  for f in "$DIR"/wait-*; do
    [ -f "$f" ] || continue
    if wait_dead "$f"; then rm -f "$f" 2>/dev/null; continue; fi
    pool=$(wfield "$f" pool); [ -n "$pool" ] || pool=general
    [ "$pool" = "$1" ] && n=$((n + 1))
  done
  echo "$n"
}
# $1 접두(slot|docker|e2e) $2 개수 — 살아 있는 보유 슬롯 수(죽은 소유자·만료된 hold 는 빈 슬롯으로 센다)
count_held() {
  local i n=0
  for i in $(nums "$2"); do
    [ -d "$DIR/$1-$i" ] || continue
    stale "$DIR/$1-$i" || n=$((n + 1))
  done
  echo "$n"
}
# 있는 E2E 풀 폴더(e2e-<수>) 경로를 한 줄씩. 개수(KE)를 바꿔도 이미 잡힌 hold 를 찾게 번호 대신 목록으로 본다.
e2e_dirs() {
  local d
  for d in "$DIR"/e2e-*; do
    [ -d "$d" ] || continue
    case "${d##*/}" in e2e-|e2e-*[!0-9]*) continue ;; esac   # e2e-1.reclaim 같은 뮤텍스는 뺀다
    echo "$d"
  done
}

# 죽은 소유자·만료된 hold·주인 없이 1분 넘은 폴더면 0(회수 대상)
stale() {
  local d="$1" pid ps0 ps1 kind st
  [ -d "$d" ] || return 1
  if [ ! -f "$d/owner" ]; then
    # mkdir 직후 owner 를 쓰기 전일 수 있다. 1분 넘게 비어 있을 때만 버려진 것으로 본다.
    [ -n "$(find "$d" -maxdepth 0 -mmin +1 2>/dev/null)" ]
    return
  fi
  pid=$(field "$d" pid); kind=$(field "$d" kind); st=$(field "$d" start)
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  alive "$pid" || return 0
  ps0=$(field "$d" pstart)
  if [ -n "$ps0" ] && [ "$ps0" != "-" ]; then
    ps1=$(pstart "$pid")
    [ -z "$ps1" ] || [ "$ps1" = "$ps0" ] || return 0   # PID 재사용
  fi
  if [ "$kind" = hold ]; then
    case "$st" in ''|*[!0-9]*) ;; *) [ $(( $(now) - st )) -le "$HOLD_TTL" ] || return 0 ;; esac
  fi
  return 1
}

reclaim() {
  local d="$1" m="$1.reclaim" who
  if ! mkdir "$m" 2>/dev/null; then
    # 회수하던 프로세스가 뮤텍스를 쥔 채 죽었으면 1분 뒤 뮤텍스를 치운다
    [ -z "$(find "$m" -maxdepth 0 -mmin +1 2>/dev/null)" ] || rmdir "$m" 2>/dev/null
    return 1
  fi
  if stale "$d"; then
    who="pid=$(field "$d" pid) kind=$(field "$d" kind) cmd=$(field "$d" cmd)"
    rm -rf "$d" && echo "HEAVY_RECLAIM $(basename "$d") $who" >&2
  fi
  rmdir "$m" 2>/dev/null
  return 0
}

# ── 독점 양보 표식(머리 주석) ─────────────────────────────────────────────
# $1 표식 파일 — 상태 active | gap | dead 를 낸다(머리 주석 「독점 양보 표식」).
excl_state() {
  local f="$1" hp hps0 hps1 seen age
  if wait_dead "$f"; then echo dead; return 0; fi   # 소유 PID(세션)가 죽었거나 PID 재사용
  seen=$(wfield "$f" seen); case "$seen" in ''|*[!0-9]*) seen=0 ;; esac
  age=$(( $(now) - seen ))
  hp=$(wfield "$f" hpid)
  case "$hp" in
    -)  # 재호출 사이 — 시간으로만 판정한다
      if [ "$age" -le "$EXCL_TTL" ]; then echo gap; else echo dead; fi ;;
    ''|*[!0-9]*)  # hpid 없는 옛 형식 — seen 으로만 판정한다
      if [ "$age" -gt "$EXCL_TTL" ]; then echo dead
      elif [ "$age" -le "$EXCL_OLD_ACTIVE" ]; then echo active
      else echo gap; fi ;;
    *)  # 기다리거나 도는 heavy.sh 가 있다 — 그 프로세스가 사라졌으면(SIGKILL 등) 곧바로 dead
      if alive "$hp"; then
        hps0=$(wfield "$f" hpstart)
        if [ -n "$hps0" ] && [ "$hps0" != - ]; then
          hps1=$(pstart "$hp")
          if [ -n "$hps1" ] && [ "$hps1" != "$hps0" ]; then echo dead; return 0; fi   # PID 재사용
        fi
        echo active
      else
        echo dead
      fi ;;
  esac
}
# $1 표식 파일 — dead 로 본 표식을 지운다. 판정과 삭제 사이에 주인이 새로 썼을 수 있으므로 표식 패턴 밖(.xdel.*)으로 옮긴
# 뒤 다시 확인한다. 살아 있으면 되돌리되, 그 사이 같은 이름에 새 표식이 생겼으면 새 것을 남긴다.
excl_reap() {
  local f="$1" t="$DIR/.xdel.${1##*/}.$$"
  mv -f "$f" "$t" 2>/dev/null || return 0
  if [ "$(excl_state "$t")" = dead ] || [ -e "$f" ]; then
    rm -f "$t" 2>/dev/null
  else
    mv -f "$t" "$f" 2>/dev/null || rm -f "$t" 2>/dev/null
  fi
  return 0
}
# 살아 있는 독점 표식을 오래된 순서(start, 같으면 이름)로 "start 이름 상태 소유PID" 한 줄씩. 죽은 표식은 지운다
excl_live() {
  local f st s
  for f in "$DIR"/excl-*; do
    [ -f "$f" ] || continue
    s=$(excl_state "$f")
    if [ "$s" = dead ]; then excl_reap "$f"; continue; fi
    st=$(wfield "$f" start); case "$st" in ''|*[!0-9]*) st=0 ;; esac
    echo "$st ${f##*/} $s $(wfield "$f" pid)"
  done | sort -k1,1n -k2,2
}
# 일반 take 가 양보해야 하면 0 — **다른 세션**의 살아 있는(active·gap) 독점 표식이 있다. 독점 실행 자신(EXCL_RUN=1)은 양보하지
# 않고, 자기 세션의 표식에도 양보하지 않는다(독점이 BUSY 로 돌아온 뒤 같은 세션이 게이트를 돌려도 스스로 막히지 않게).
EXCL_RUN=0
excl_yield() {
  [ "$EXCL_RUN" = 1 ] && return 1
  excl_live | awk -v me="$(owner_pid)" 'NF && $4 != me { found=1 } END { exit !found }'
}
# 사람용: 살아 있는 독점 표식 목록 " | " 구분. 없으면 빈 문자열
excl_holders() {
  local st name s pid f age out="" tag
  while read -r st name s pid; do
    [ -n "$name" ] || continue
    f="$DIR/$name"
    age=$(wfield "$f" start); case "$age" in ''|*[!0-9]*) age='?' ;; *) age=$(( ($(now) - age) / 60 )) ;; esac
    tag=; [ "$s" != gap ] || tag=' 재호출 대기'
    out="$out${out:+ | }[excl pid=$pid ${age}분$tag] $(wfield "$f" cmd)"
  done <<XEOF
$(excl_live)
XEOF
  echo "$out"
}
excl_note() { local s; s=$(excl_holders); [ -z "$s" ] || printf ' 독점 대기: %s' "$s"; }
# 이 호출의 표식 경로·start·lstart. 첫 excl_mark 가 정한다
MYX=; MYXST=; MYXPS=; OWNPS=
# $1 소유 PID $2 cmd [$3 hpid — 기본 $$, '-' 면 재호출 사이(gap)] — 이 호출의 표식을 쓴다. 첫 호출은 이 세션의 gap 표식
# (가장 오래된 것 하나)을 원자적 mv 로 이어받아 start 를 지킨다 — 같은 세션의 독점 둘이 겨뤄도 mv 는 하나만 이긴다.
# 임시 파일은 어떤 표식 패턴(slot-*·docker-*·e2e-*·wait-*·excl-*)에도 걸리지 않는 .xtmp.* 에 쓴다.
excl_mark() {
  local o="$1" hp="${3:-$$}" t="$DIR/.xtmp.$$" f s bst= best= c hps
  if [ -z "$MYX" ]; then
    MYX="$DIR/excl-$o-$$"
    for f in "$DIR"/excl-*; do
      [ -f "$f" ] && [ "$f" != "$MYX" ] && [ "$(wfield "$f" pid)" = "$o" ] || continue
      [ "$(excl_state "$f")" = gap ] || continue
      s=$(wfield "$f" start); case "$s" in ''|*[!0-9]*) continue ;; esac
      if [ -z "$bst" ] || [ "$s" -lt "$bst" ]; then bst="$s"; best="$f"; fi
    done
    # 이어받을 표식을 곧바로 내 이름으로 옮긴다 — 표식이 사라지는 순간이 없어 남의 게이트가 그 틈에 슬롯을 잡지 않는다
    if [ -n "$best" ] && mv "$best" "$MYX" 2>/dev/null; then MYXST=$(wfield "$MYX" start); fi
    case "$MYXST" in ''|*[!0-9]*) MYXST=$(now) ;; esac
    MYXPS=$(pstart "$$"); OWNPS=$(pstart "$o")
  fi
  c=$(printf '%s' "$2" | tr '\n' ' ')
  hps="${MYXPS:--}"; [ "$hp" != - ] || hps=-
  if { echo "pid=$o"; echo "pstart=${OWNPS:--}"; echo "hpid=$hp"; echo "hpstart=$hps"; echo "start=$MYXST"; echo "seen=$(now)"
       echo "cwd=$PWD"; echo "cmd=$c"; } > "$t" 2>/dev/null && mv -f "$t" "$MYX" 2>/dev/null; then return 0; fi
  rm -f "$t" 2>/dev/null
  return 1
}
excl_unmark() { [ -z "$MYX" ] || rm -f "$MYX" 2>/dev/null; }
# $1 소유 PID — 이 세션의 gap 표식(재호출 대기)을 지운다. 이 세션의 다른 독점이 지금 기다리는(active) 표식은 두고 간다.
excl_drop_gap() {
  local f
  for f in "$DIR"/excl-*; do
    [ -f "$f" ] && [ "$(wfield "$f" pid)" = "$1" ] || continue
    [ "$(excl_state "$f")" != gap ] || rm -f "$f" 2>/dev/null
  done
  return 0
}
# 사람용: 살아 있는 일반 슬롯 hold(E2E 풀을 끈 acquire·옛 heavy.sh 의 acquire) 목록. 없으면 빈 문자열.
# 독점은 이 hold 가 풀리기 전에는 K개를 모을 수 없다(hold 는 release·TTL 로만 풀린다).
general_holds() {
  local i d age out=""
  for i in $(nums "$K"); do
    d="$DIR/slot-$i"
    [ "$(field "$d" kind)" = hold ] || continue
    stale "$d" && continue
    age=$(field "$d" start); case "$age" in ''|*[!0-9]*) age='?' ;; *) age=$(( ($(now) - age) / 60 )) ;; esac
    out="$out${out:+ | }[slot-$i pid=$(field "$d" pid) ${age}분 hold] $(field "$d" cmd)"
  done
  echo "$out"
}

# $1 kind  $2 pid  $3 cmd  [$4 접두(slot|docker|e2e) $5 개수] — 빈 슬롯을 잡으면 SLOT(도커면 DSLOT)에 경로를 넣고 0.
# 일반 슬롯은 다른 세션의 독점 표식이 있으면 잡지 않는다(양보).
take() {
  local i d t p c pre="${4:-slot}" n="${5:-$K}"
  if [ "$pre" = slot ] && excl_yield; then return 1; fi
  p=$(pstart "$2"); c=$(printf '%s' "$3" | tr '\n' ' ')
  for i in $(nums "$n"); do
    d="$DIR/$pre-$i"
    if mkdir "$d" 2>/dev/null; then
      t="$d/owner.tmp.$$"
      {
        echo "pid=$2"
        echo "kind=$1"
        echo "start=$(now)"
        echo "pstart=${p:--}"
        echo "host=$(hostname 2>/dev/null || uname -n)"
        echo "cwd=$PWD"
        echo "cmd=$c"
      } > "$t" && mv "$t" "$d/owner" || { rm -rf "$d"; continue; }
      if [ "$pre" = docker ]; then DSLOT="$d"; else SLOT="$d"; fi
      return 0
    fi
  done
  return 1
}

# ── 부하 검사(머리 주석) ──────────────────────────────────────────────────
# 1분 부하 평균이 코어 수 × LOAD_MAX 를 넘으면 0 과 LOADMSG="load=<l>>cap=<c>". 꺼졌거나(LOAD_MAX=0) 못 읽으면 1(fail-open).
LOADMSG=
load_over() {
  local l c
  LOADMSG=
  l=$(load1) || return 1
  c=$(ncpus) || return 1
  LOADMSG=$(awk -v l="$l" -v c="$c" -v m="$LOAD_MAX" 'BEGIN {
    if (m + 0 <= 0) exit 1
    cap = c * m
    if (l + 0 > cap) { printf "load=%.1f>cap=%.1f", l, cap; exit 0 }
    exit 1 }') && return 0
  LOADMSG=
  return 1
}
# 살아 있는 일반 슬롯 중 실행(kind≠hold) 보유 수. 기아 방지는 이것만 센다 — hold(E2E 풀을 끈 acquire)는 한 시간씩 떠 있을
# 수 있어, 세면 부하가 높은 동안 새 일반 슬롯이 hold TTL 내내 미뤄진다. status·snapshot 의 held 는 count_held 그대로다.
count_run_slots() {
  local i d n=0
  for i in $(nums "$K"); do
    d="$DIR/slot-$i"
    [ -d "$d" ] || continue
    [ "$(field "$d" kind)" = hold ] && continue
    stale "$d" || n=$((n + 1))
  done
  echo "$n"
}
# 새 일반 슬롯을 미뤄야 하면 0(LOADMSG 에 이유). 기아 방지: 살아 있는 일반 풀 실행 보유자가 0명이면 부하와 무관하게 준다.
load_defer() {
  load_over || return 1
  [ "$(count_run_slots)" -ge 1 ] && return 0
  LOADMSG=
  return 1
}
# wait_slot·wait_docker 의 대기 알림: 부하 때문에 미뤘다는 사실을 처음 한 번 알린다. $1 LOADMSG $2 풀 표시(k=… 등)
LOAD_ANNOUNCED=0
load_announce() {
  [ -n "$1" ] && [ "$LOAD_ANNOUNCED" = 0 ] || return 0
  echo "HEAVY_LOAD_WAIT $1 $2 — 1분 부하 평균이 코어 수 × ${LOAD_MAX} 를 넘어 새 슬롯을 미룬다(쥔 슬롯은 그대로, 부하가 내려가면 준다)" >&2
  LOAD_ANNOUNCED=1
}
# BUSY·WAIT 줄 끝에 붙일 부하 표시. 비었으면 빈 문자열
load_note() { [ -z "$1" ] || printf ' 부하 대기: %s' "$1"; }
# 일반 풀의 새 take — 부하 검사를 먼저 한다. 이유는 LOADWHY 에 남긴다(비었으면 부하 때문이 아님).
# E2E 풀(pre=e2e)은 검사하지 않는다(머리 주석).
LOADWHY=
take_new() { # take 와 같은 인자
  LOADWHY=
  if [ "${4:-slot}" = slot ] && load_defer; then LOADWHY="$LOADMSG"; return 1; fi
  take "$@"
}

holders() { # [$1 접두(slot|docker|e2e) $2 개수]
  local i d out="" age pre="${1:-slot}" n="${2:-$K}"
  for i in $(nums "$n"); do
    d="$DIR/$pre-$i"
    [ -d "$d" ] || continue
    age=$(field "$d" start); case "$age" in ''|*[!0-9]*) age='?' ;; *) age=$(( ($(now) - age) / 60 )) ;; esac
    out="$out${out:+ | }[$pre-$i pid=$(field "$d" pid) ${age}분 $(field "$d" kind)] $(field "$d" cmd)"
  done
  echo "$out"
}

# 슬롯을 얻기까지 기다린 초 — 얻은 줄(HEAVY_SLOT·HEAVY_DOCKER_SLOT·HEAVY_ACQUIRED·HEAVY_EXCL) 끝에 `waited=<초>s` 로 붙인다.
# 포기(HEAVY_BUSY … wait=Ns)만 시간이 남으면 기다려 얻은 대기를 잴 수 없다(2026-09-26 dmes-standard 7건: 포기 대기 34회·133.5분,
# 단일 gradlew 128회의 "Gradle 밖 시간" 74분이 성공한 대기로 추정되나 측정 불가). 기존 앞부분 형식은 그대로 두고 끝에만 붙인다.
# 분리 실행(--detach)의 자식도 같은 줄을 잡 로그에 남긴다.
WAIT_T0=
waited() { echo "waited=$(( $(now) - ${WAIT_T0:-$(now)} ))s"; }

# 대기 상한 안에 슬롯을 잡는다. 못 잡으면 HEAVY_BUSY 를 내고 1
# $1 kind $2 pid $3 cmd [$4 접두(slot|e2e) $5 개수] — e2e 면 E2E 풀(acquire)
wait_slot() {
  local kind="$1" pid="$2" cmd="$3" pre="${4:-slot}" n="${5:-$K}" deadline announced=0 i tag pool note
  if [ "$pre" = e2e ]; then tag="e2e=$n"; pool=e2e; else tag="k=$K"; pool=general; fi
  # 슬롯 폴더를 못 만들면 줄 세우기를 포기하고 그냥 돌린다(성능 보호이지 보안 가드가 아니다 — fail-open)
  mkdir -p "$DIR" 2>/dev/null || { echo "HEAVY_UNLOCKED 슬롯 폴더를 만들 수 없음: $DIR" >&2; return 2; }
  WAIT_T0=$(now); deadline=$(( WAIT_T0 + WAIT ))
  while :; do
    # 일반 풀은 take_new 가 부하 검사를 먼저 한다(E2E 풀은 검사하지 않는다 — 머리 주석 「부하 검사」)
    take_new "$kind" "$pid" "$cmd" "$pre" "$n" && { wait_unmark; return 0; }
    for i in $(nums "$n"); do stale "$DIR/$pre-$i" && reclaim "$DIR/$pre-$i"; done
    take_new "$kind" "$pid" "$cmd" "$pre" "$n" && { wait_unmark; return 0; }
    note=; [ "$pre" != slot ] || note="$(excl_note)$(load_note "$LOADWHY")"
    if [ "$(now)" -ge "$deadline" ]; then
      wait_unmark
      echo "HEAVY_BUSY $tag wait=${WAIT}s 보유: $(holders "$pre" "$n")$note" >&2
      return 1
    fi
    wait_mark "$pool" "$cmd"
    if [ "$announced" != 1 ]; then
      echo "HEAVY_WAIT $tag 보유: $(holders "$pre" "$n")$note" >&2; announced=1
    fi
    load_announce "$LOADWHY" "$tag"
    sleep "$POLL"
  done
}

# 도커 풀: 대기 상한 안에 도커 슬롯(+ need_general=1 이면 일반 슬롯)을 **한 번에** 잡는다. 도커 슬롯을 잡았는데
# 일반 슬롯이 없으면 도커 슬롯을 곧바로 돌려준다 — 도커 슬롯을 쥔 채 기다리지 않는다(머리의 교착 불변식).
# 못 잡으면 HEAVY_DOCKER_BUSY 를 내고 1
wait_docker() {
  local pid="$1" cmd="$2" need="$3" deadline announced=0 i
  mkdir -p "$DIR" 2>/dev/null || { echo "HEAVY_UNLOCKED 슬롯 폴더를 만들 수 없음: $DIR" >&2; return 2; }
  WAIT_T0=$(now); deadline=$(( WAIT_T0 + WAIT ))
  while :; do
    DSLOT=; SLOT=; LOADWHY=
    # 새 일반 슬롯이 필요하면(need=1) 부하 검사를 도커 슬롯을 잡기 **전에** 한다 — 도커 슬롯을 잡았다 돌려주기를 되풀이하지
    # 않고, 도커 슬롯을 쥔 채 부하를 기다리지도 않는다(교착 불변식). 이미 일반·E2E 슬롯을 쥔 호출(need=0)은 검사하지 않는다.
    if [ "$need" = 1 ] && load_defer; then
      LOADWHY="$LOADMSG"
    elif take run "$pid" "[docker] $cmd" docker "$KD"; then
      if [ "$need" = 0 ] || take run "$pid" "[docker] $cmd" slot "$K"; then wait_unmark; return 0; fi
      rm -rf "$DSLOT"; DSLOT=
    fi
    for i in $(seq 1 "$KD"); do stale "$DIR/docker-$i" && reclaim "$DIR/docker-$i"; done
    for i in $(seq 1 "$K"); do stale "$DIR/slot-$i" && reclaim "$DIR/slot-$i"; done
    if [ "$(now)" -ge "$deadline" ]; then
      wait_unmark
      echo "HEAVY_DOCKER_BUSY k=$K docker=$KD wait=${WAIT}s 도커: $(holders docker "$KD") 일반: $(holders)$(excl_note)$(load_note "$LOADWHY")" >&2
      return 1
    fi
    wait_mark docker "$cmd"
    if [ "$announced" != 1 ]; then
      echo "HEAVY_DOCKER_WAIT k=$K docker=$KD 도커: $(holders docker "$KD") 일반: $(holders)$(excl_note)$(load_note "$LOADWHY")" >&2; announced=1
    fi
    load_announce "$LOADWHY" "k=$K docker=$KD"
    sleep "$POLL"
  done
}

# 이 세션(OWNER)이 acquire 로 붙잡은 슬롯 경로들 — E2E 풀 먼저, 그다음 일반 슬롯
held_by() {
  local i d
  e2e_dirs | while IFS= read -r d; do
    [ "$(field "$d" kind)" = hold ] && [ "$(field "$d" pid)" = "$1" ] && echo "$d"
  done
  for i in $(seq 1 "$K"); do
    d="$DIR/slot-$i"
    [ "$(field "$d" kind)" = hold ] && [ "$(field "$d" pid)" = "$1" ] && echo "$d"
  done
  return 0
}

mine_release() { # 내 것일 때만 지운다(회수된 뒤 남이 잡은 슬롯을 지우지 않게)
  [ -n "${SLOT:-}" ] && [ "$(field "$SLOT" pid)" = "$MYPID" ] && rm -rf "$SLOT"
  [ -n "${DSLOT:-}" ] && [ "$(field "$DSLOT" pid)" = "$MYPID" ] && rm -rf "$DSLOT"
  SLOT=; DSLOT=
  wait_unmark
}

# 분리 실행의 손자 heavy.sh 인가(cmd_job 이 DFLOW_HEAVY_IN_JOB=1 로 띄운다). 그 손자는 세션의 hold 를 다시 쓰지 않고 자기
# 슬롯을 잡는다 — 세션이 서버를 끄고 release 하면 그 hold 가 풀려, 아직 도는 잡이 슬롯 없이 돌게 되기 때문이다.
# 변수는 곧바로 지워 실제 명령(과 그 안의 heavy.sh)에는 물려주지 않는다.
IN_JOB="${DFLOW_HEAVY_IN_JOB:-}"
unset DFLOW_HEAVY_IN_JOB

cmd_run() {
  local rc h=
  [ $# -ge 1 ] || { echo "사용법: heavy.sh <명령> [인자…]" >&2; exit 2; }
  # 안쪽 호출(무거운 명령이 또 heavy.sh 를 부름)이거나 이 세션이 acquire 로 붙잡은 슬롯이 있으면 새 슬롯을 기다리지 않는다
  # (분리 실행의 손자는 예외 — 위 IN_JOB)
  if [ -n "${DFLOW_HEAVY_HELD:-}" ] && [ -d "$DFLOW_HEAVY_HELD" ]; then exec "$@"; fi
  [ -n "$IN_JOB" ] || h=$(held_by "$(owner_pid)" | head -n 1)
  if [ -n "$h" ]; then
    echo "HEAVY_REUSE $(basename "$h")" >&2
    DFLOW_HEAVY_HELD="$h" exec "$@"
  fi

  MYPID=$$; SLOT=; child=
  on_sig() {
    [ -n "$child" ] && { command -v pkill >/dev/null 2>&1 && pkill -TERM -P "$child" 2>/dev/null; kill -TERM "$child" 2>/dev/null; wait "$child" 2>/dev/null; }
    mine_release; exit "$1"
  }
  trap 'on_sig 130' INT; trap 'on_sig 143' TERM; trap 'on_sig 129' HUP
  trap 'mine_release' EXIT
  wait_slot run "$MYPID" "$*"; rc=$?
  [ "$rc" -ne 1 ] || exit "$BUSY_RC"
  if [ "$rc" -eq 0 ]; then
    echo "HEAVY_SLOT $(basename "$SLOT") k=$K $(waited)" >&2
    export DFLOW_HEAVY_HELD="$SLOT"
  fi
  "$@" &
  child=$!
  wait "$child"; rc=$?
  child=
  exit "$rc"
}

cmd_run_docker() {
  local rc h need=1
  [ $# -ge 1 ] || { echo "사용법: heavy.sh --pool docker <명령> [인자…]" >&2; exit 2; }
  # 안쪽 도커 호출(도커 슬롯을 쥔 실행이 또 --pool docker 를 부름)은 기다리지 않는다
  if [ -n "${DFLOW_HEAVY_DOCKER_HELD:-}" ] && [ -d "$DFLOW_HEAVY_DOCKER_HELD" ]; then exec "$@"; fi
  # 이미 일반·E2E 슬롯을 쥐고 있으면(감싼 실행 안, 또는 이 세션의 acquire) 도커 슬롯만 잡는다
  if [ -n "${DFLOW_HEAVY_HELD:-}" ] && [ -d "$DFLOW_HEAVY_HELD" ]; then
    need=0
  elif [ -z "$IN_JOB" ]; then
    h=$(held_by "$(owner_pid)" | head -n 1)
    if [ -n "$h" ]; then
      echo "HEAVY_REUSE $(basename "$h")" >&2
      export DFLOW_HEAVY_HELD="$h"; need=0
    fi
  fi

  MYPID=$$; SLOT=; DSLOT=; child=
  on_sig() {
    [ -n "$child" ] && { command -v pkill >/dev/null 2>&1 && pkill -TERM -P "$child" 2>/dev/null; kill -TERM "$child" 2>/dev/null; wait "$child" 2>/dev/null; }
    mine_release; exit "$1"
  }
  trap 'on_sig 130' INT; trap 'on_sig 143' TERM; trap 'on_sig 129' HUP
  trap 'mine_release' EXIT
  wait_docker "$MYPID" "$*" "$need"; rc=$?
  [ "$rc" -ne 1 ] || exit "$BUSY_RC"
  if [ "$rc" -eq 0 ]; then
    echo "HEAVY_DOCKER_SLOT $(basename "$DSLOT") docker=$KD${SLOT:+ + $(basename "$SLOT") k=$K} $(waited)" >&2
    export DFLOW_HEAVY_DOCKER_HELD="$DSLOT"
    [ -z "$SLOT" ] || export DFLOW_HEAVY_HELD="$SLOT"
  fi
  "$@" &
  child=$!
  wait "$child"; rc=$?
  child=
  exit "$rc"
}

# 독점 실행이 잡은 일반 슬롯들(줄바꿈 구분 — 경로에 공백이 있을 수 있다). 대기 표식은 건드리지 않는다
# (take_all 이 실패할 때마다 표식을 지웠다 다시 쓰면 WAIT 의 시작 시각이 흔들린다).
EXSLOTS=
excl_release_all() {
  local d
  while IFS= read -r d; do
    [ -n "$d" ] && [ "$(field "$d" pid)" = "$MYPID" ] && rm -rf "$d"
  done <<EOF
$EXSLOTS
EOF
  EXSLOTS=
}
# 일반 슬롯 K개를 한 번에 잡는다. 하나라도 못 잡으면 잡은 것을 모두 돌려주고 1(쥐고 기다리지 않는다)
take_all() {
  local i
  EXSLOTS=
  for i in $(seq 1 "$K"); do
    SLOT=
    if take run "$MYPID" "$1"; then
      EXSLOTS="$EXSLOTS$SLOT
"
    else
      excl_release_all; SLOT=
      return 1
    fi
  done
  SLOT=
  return 0
}

cmd_run_exclusive() {
  local o h why= rc deadline announced=0 i list ahead pos n t0 gh me
  [ $# -ge 1 ] || { echo "사용법: heavy.sh --exclusive <명령> [인자…]" >&2; exit 2; }
  o=$(owner_pid)
  # 슬롯을 쥔 채 K개 전부를 기다리면 자기 슬롯이 풀리지 않아 영원히 못 잡는다(교착) — 거부한다.
  # 분리 실행의 손자(IN_JOB)는 세션의 E2E 풀 hold 는 보지 않는다(일반 풀만 독점하므로 겹치지 않는다 — 잡은 세션과 따로 돈다).
  # 세션의 일반 슬롯 hold(E2E 풀을 끈 acquire)는 잡에서도 거부한다 — 「독점 불가」 BUSY 로 돌려주면 다시 --detach 해도
  # 세션이 release 하기 전에는 영영 못 잡는데, BUSY 는 release 하라고 알려 주지 않는다.
  if [ -n "${DFLOW_HEAVY_HELD:-}" ] && [ -d "$DFLOW_HEAVY_HELD" ]; then
    why="감싼 실행 안($(basename "$DFLOW_HEAVY_HELD"))"
  elif [ -n "${DFLOW_HEAVY_DOCKER_HELD:-}" ] && [ -d "$DFLOW_HEAVY_DOCKER_HELD" ]; then
    why="도커 슬롯 실행 안($(basename "$DFLOW_HEAVY_DOCKER_HELD"))"
  else
    if [ -z "$IN_JOB" ]; then
      h=$(held_by "$o" | head -n 1)
    else
      h=$(held_by "$o" | grep '/slot-[0-9]*$' | head -n 1)
    fi
    [ -z "$h" ] || why="이 세션(owner=$o)이 $(basename "$h") 를 붙잡고 있다(acquire)"
  fi
  if [ -n "$why" ]; then
    # 이 세션은 지금 독점을 기다릴 수 없다 — 앞서 BUSY 로 남긴 재호출 대기 표식이 남을 막지 않게 지운다
    excl_drop_gap "$o"
    echo "HEAVY_EXCL_NESTED $why — 슬롯을 쥔 채 독점을 기다리지 않는다. release 하거나 감싼 실행 밖에서 부른다" >&2
    exit 2
  fi
  if ! mkdir -p "$DIR" 2>/dev/null; then
    echo "HEAVY_UNLOCKED 슬롯 폴더를 만들 수 없음: $DIR" >&2
    exec "$@"
  fi

  MYPID=$$; SLOT=; EXSLOTS=; child=; EXCL_RUN=1
  on_sig() {
    [ -n "$child" ] && { command -v pkill >/dev/null 2>&1 && pkill -TERM -P "$child" 2>/dev/null; kill -TERM "$child" 2>/dev/null; wait "$child" 2>/dev/null; }
    excl_unmark
    excl_release_all; wait_unmark; exit "$1"
  }
  trap 'on_sig 130' INT; trap 'on_sig 143' TERM; trap 'on_sig 129' HUP
  trap 'excl_release_all; wait_unmark' EXIT
  t0=$(now)
  deadline=$(( t0 + WAIT ))
  while :; do
    # 살아 있는 일반 슬롯 hold 가 있으면 기다려도 K개를 모을 수 없다(hold 는 release·TTL 로만 풀린다). 표식을 두면 그동안
    # 모든 새 일반 take 가 멈추므로, 표식 없이(이 세션의 재호출 대기 표식도 지우고) 곧바로 BUSY 로 돌아온다. 옛 heavy.sh 의
    # acquire 는 표식에 양보하지 않으므로 기다리는 중에도 매번 본다.
    gh=$(general_holds)
    if [ -n "$gh" ]; then
      excl_unmark; excl_drop_gap "$o"; wait_unmark
      echo "HEAVY_BUSY k=$K wait=$(( $(now) - t0 ))s 독점 불가: E2E hold 보유 중 $gh — 일반 슬롯을 붙잡은 E2E 서버(acquire)가 release 된 뒤 다시 부른다" >&2
      exit "$BUSY_RC"
    fi
    # 기다리는 내내 표식(hpid=$$·seen)을 새로 쓴다 — active. 분리 실행(--detach --exclusive)은 TTL 보다 오래 기다릴 수 있다.
    excl_mark "$o" "$*"
    list=$(excl_live)
    me="${MYX##*/}"
    # 나보다 앞선(start·이름 순) **active** 표식 수. 재호출 사이(gap)의 선두는 앞지른다(머리 주석). 내 표식을 못 찾으면(못
    # 썼으면) x — 순번 없이 시도한다.
    ahead=$(printf '%s\n' "$list" | awk -v me="$me" 'NF { if ($2 == me) { print c + 0; f = 1; exit } if ($3 == "active") c++ } END { if (!f) print "x" }')
    if [ "$ahead" = 0 ] || [ "$ahead" = x ]; then
      for i in $(seq 1 "$K"); do stale "$DIR/slot-$i" && reclaim "$DIR/slot-$i"; done
      take_all "$*" && { wait_unmark; break; }
    fi
    pos=$(printf '%s\n' "$list" | awk -v me="$me" 'NF && $2 == me { print NR; exit }')
    n=$(printf '%s\n' "$list" | awk 'NF { c++ } END { print c + 0 }')
    if [ "$(now)" -ge "$deadline" ]; then
      wait_unmark
      # 표식을 재호출 대기(gap, hpid=-)로 남긴다 — TTL(기본 180초) 안에 다시 부르면 start(순번)를 이어받는다
      excl_mark "$o" "$*" -
      echo "HEAVY_BUSY k=$K wait=${WAIT}s 독점 대기(순번 ${pos:-?}/$n, 표식은 남긴다) 보유: $(holders)" >&2
      exit "$BUSY_RC"
    fi
    wait_mark general "$*"
    [ "$announced" = 1 ] || { echo "HEAVY_EXCL_WAIT k=$K 순번 ${pos:-?}/$n 보유: $(holders)" >&2; announced=1; }
    sleep "$POLL"
  done
  WAIT_T0=$t0
  echo "HEAVY_EXCL k=$K 일반 슬롯 ${K}개를 모두 잡았다 $(waited)" >&2
  export DFLOW_HEAVY_HELD
  DFLOW_HEAVY_HELD=$(printf '%s' "$EXSLOTS" | head -n 1)
  "$@" &
  child=$!
  wait "$child"; rc=$?
  child=
  excl_unmark
  exit "$rc"
}

cmd_acquire() {
  local o h rc
  # 감싼 실행 안에서 부르면 그 실행의 슬롯을 쓴다 — 쥔 슬롯 위에서 두 번째 슬롯을 기다리지 않는다(교착 불변식).
  # 그 슬롯은 감싼 실행이 끝나면 풀리므로, 서버는 그 실행 안에서 끄고 끝낸다.
  if [ -n "${DFLOW_HEAVY_HELD:-}" ] && [ -d "$DFLOW_HEAVY_HELD" ]; then
    echo "HEAVY_ACQUIRED $(basename "$DFLOW_HEAVY_HELD") (감싼 실행의 슬롯) k=$K" >&2; exit 0
  fi
  o=$(owner_pid)
  h=$(held_by "$o" | head -n 1)
  if [ -n "$h" ]; then excl_drop_gap "$o"; echo "HEAVY_ACQUIRED $(basename "$h") (이미 보유) owner=$o" >&2; exit 0; fi
  MYPID="$o"; SLOT=
  trap 'mine_release; exit 130' INT; trap 'mine_release; exit 143' TERM; trap 'mine_release; exit 129' HUP
  if [ "$KE" -ge 1 ]; then
    wait_slot hold "$o" "hold ${1:-e2e}" e2e "$KE"; rc=$?
  else
    wait_slot hold "$o" "hold ${1:-e2e}"; rc=$?
  fi
  [ "$rc" -ne 1 ] || exit "$BUSY_RC"
  [ "$rc" -eq 0 ] || exit 0   # HEAVY_UNLOCKED: 붙잡지 못했지만 막지 않는다
  # 슬롯을 붙잡은 세션은 독점을 부르지 못한다(HEAVY_EXCL_NESTED) — 앞서 BUSY 로 남긴 재호출 대기 표식이 남을 막지 않게 지운다
  excl_drop_gap "$o"
  if [ "$KE" -ge 1 ]; then
    echo "HEAVY_ACQUIRED $(basename "$SLOT") owner=$o e2e=$KE $(waited)" >&2
  else
    echo "HEAVY_ACQUIRED $(basename "$SLOT") owner=$o k=$K $(waited)" >&2
  fi
  exit 0
}

cmd_release() {
  local o list
  o=$(owner_pid)
  list=$(held_by "$o")
  [ -n "$list" ] || { echo "HEAVY_RELEASED none owner=$o" >&2; exit 0; }
  # 경로에 공백이 있을 수 있다(Windows 사용자 폴더) — 줄 단위로 읽는다
  printf '%s\n' "$list" | while IFS= read -r d; do
    rm -rf "$d" && echo "HEAVY_RELEASED $(basename "$d") owner=$o" >&2
  done
  exit 0
}

# stdout 은 정확히 한 줄(기계가 읽는다). 세부는 stderr. 늘 exit 0 — 폴더가 없거나 못 읽어도 held=0 waiting=0 이다.
cmd_status() {
  local g h
  echo "HEAVY_STATUS slots=$K held=$(count_held slot "$K") waiting=$(count_waiting general)"
  g=$(ram_gb) || g='?'
  {
    echo "HEAVY_DETAIL k=$K ram=${g}GB dir=$DIR wait=${WAIT}s"
    h=$(holders); echo "${h:-(비어 있음)}"
    h=$(holders docker "$KD")
    echo "HEAVY_DOCKER docker=$KD held=$(count_held docker "$KD") waiting=$(count_waiting docker) ${h:-(비어 있음)}"
    if [ "$KE" -ge 1 ]; then
      h=$(holders e2e "$KE")
      echo "HEAVY_E2E e2e=$KE held=$(count_held e2e "$KE") waiting=$(count_waiting e2e) ${h:-(비어 있음)}"
    else
      echo "HEAVY_E2E e2e=0 (꺼짐 — acquire 는 일반 슬롯을 쓴다)"
    fi
    h=$(excl_holders); [ -z "$h" ] || echo "HEAVY_EXCL $h"
  } >&2
  exit 0
}

# 탭·줄바꿈은 공백으로 — snapshot 필드가 밀리지 않게
tabless() { printf '%s' "$1" | tr '\t\n' '  '; }
snap_run() { # $1 슬롯 폴더 $2 pool
  printf 'RUN\t%s\t%s\t%s\t%s\t%s\n' "$(field "$1" start)" "$(field "$1" kind)" "$2" \
    "$(tabless "$(field "$1" cwd)")" "$(tabless "$(field "$1" cmd | sed 's/^\[docker\] //')")"
}
cmd_snapshot() {
  local i d f pid load cpus seen=' ' gseen= key pool
  # 부하 검사와 같은 읽기(load1·ncpus). 못 읽으면 '-'
  load=$(load1) || load=-
  cpus=$(ncpus) || cpus=-
  printf 'PC\t%s\t%s\t%s\t%s\t%s\n' "$K" "$(count_held slot "$K")" "$(count_waiting general)" "$load" "$cpus"
  # 도커 슬롯 먼저 — 같은 pid 가 쥔 일반 슬롯은 건너뛰어 한 줄로 합친다
  for i in $(seq 1 "$KD"); do
    d="$DIR/docker-$i"
    [ -f "$d/owner" ] || continue
    stale "$d" && continue
    pid=$(field "$d" pid); seen="$seen$pid "
    snap_run "$d" docker
  done
  # 일반 슬롯 — 독점 실행은 같은 pid·kind·cmd 로 K개를 쥐지만 한 줄로 낸다(그 밖의 슬롯은 예전처럼 하나씩)
  for i in $(seq 1 "$K"); do
    d="$DIR/slot-$i"
    [ -f "$d/owner" ] || continue
    stale "$d" && continue
    pid=$(field "$d" pid)
    case "$seen" in *" $pid "*) continue ;; esac
    key="<$pid|$(field "$d" kind)|$(field "$d" cmd)>"
    case "$gseen" in *"$key"*) continue ;; esac
    gseen="$gseen$key"
    snap_run "$d" general
  done
  # E2E 풀 보유는 앱이 아는 값으로 — `RUN … hold general …`
  while IFS= read -r d; do
    [ -n "$d" ] && [ -f "$d/owner" ] || continue
    stale "$d" && continue
    snap_run "$d" general
  done <<EOF
$(e2e_dirs)
EOF
  for f in "$DIR"/wait-*; do
    [ -f "$f" ] || continue
    wait_dead "$f" && continue
    pool=$(wfield "$f" pool)
    case "$pool" in docker) ;; *) pool=general ;; esac   # E2E 풀 대기(e2e)도 general 로 — 앱은 general·docker 만 받는다
    printf 'WAIT\t%s\t%s\t%s\t%s\n' "$(wfield "$f" start)" "$pool" \
      "$(tabless "$(wfield "$f" cwd)")" "$(tabless "$(wfield "$f" cmd)")"
  done
  exit 0
}

# ── 분리 실행(머리 주석 --detach·wait) ─────────────────────────────────────
# $1 표시할 명령 문자열, 나머지 = 자식 heavy.sh 에 그대로 넘길 인자(--pool docker·--exclusive 포함)
cmd_detach() {
  local shown="$1" id jd pid i=0
  shift
  mkdir -p "$JOBS" 2>/dev/null || { echo "HEAVY_DETACH_FAIL 잡 폴더를 만들 수 없음: $JOBS" >&2; exit 2; }
  # 끝난 지 7일 지난 잡은 지운다(잡 폴더는 워크트리 밖이라 누가 치우지 않는다)
  find "$JOBS" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null
  id="$(date +%Y%m%d-%H%M%S)-$$"
  while ! mkdir "$JOBS/$id" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -le 50 ] || { echo "HEAVY_DETACH_FAIL 잡 폴더를 만들 수 없음: $JOBS/$id" >&2; exit 2; }
    id="$(date +%Y%m%d-%H%M%S)-$$-$i"
  done
  jd="$JOBS/$id"
  printf '%s\n' "$shown" > "$jd/cmd"
  printf '%s\n' "$PWD" > "$jd/cwd"
  now > "$jd/start"
  : > "$jd/log"
  # 자식은 호출한 셸의 stdout·stderr 를 물려받지 않는다(물려받으면 Bash 도구가 잡이 끝날 때까지 돌아오지 않는다).
  # set -m 으로 자기 프로세스 그룹에 띄우고 nohup 으로 HUP 을 무시한다(macOS 에는 setsid 가 없다).
  # 감싼 실행 안에서 불러도 자식은 자기 슬롯을 잡는다 — 바깥 실행이 끝나면 그 슬롯이 풀리기 때문이다.
  set -m
  DFLOW_HEAVY_WAIT="$DETACH_WAIT" DFLOW_HEAVY_HELD= DFLOW_HEAVY_DOCKER_HELD= \
    nohup bash "$SELF" __job "$jd" "$@" > "$jd/log" 2>&1 < /dev/null &
  pid=$!
  set +m
  echo "$pid" > "$jd/pid"
  pstart "$pid" > "$jd/pstart"
  echo "HEAVY_DETACHED id=$id pid=$pid log=$jd/log"
  exit 0
}

# 내부용: 분리된 자식. heavy.sh 를 자식으로 돌리고(그 exec 지름길이 rc 쓰기를 건너뛰지 않게) rc 를 원자적으로 쓴다.
cmd_job() {
  local jd="$1" c rc
  shift
  DFLOW_HEAVY_IN_JOB=1 bash "$SELF" "$@" &
  c=$!
  # 명령을 돌리는(슬롯을 쥐는) 손자 heavy.sh — 이 잡만 강제 종료돼도 손자는 돈다. wait 가 그 생존을 본다(runpstart 먼저, runpid 는 원자적으로)
  pstart "$c" > "$jd/runpstart" 2>/dev/null
  echo "$c" > "$jd/runpid.tmp.$$" 2>/dev/null && mv -f "$jd/runpid.tmp.$$" "$jd/runpid" 2>/dev/null
  trap 'kill -TERM "$c" 2>/dev/null' TERM INT
  while :; do
    wait "$c"; rc=$?
    kill -0 "$c" 2>/dev/null || break
  done
  echo "HEAVY_JOB_END rc=$rc"
  echo "$rc" > "$jd/rc.tmp.$$" && mv -f "$jd/rc.tmp.$$" "$jd/rc"
  exit "$rc"
}

# $1 잡 폴더 — 명령을 돌리는 손자 heavy.sh(runpid, + lstart)가 살아 있으면 0
job_run_alive() {
  local rp r0 r1
  rp=$(cat "$1/runpid" 2>/dev/null)
  case "$rp" in ''|*[!0-9]*) return 1 ;; esac
  alive "$rp" || return 1
  r0=$(cat "$1/runpstart" 2>/dev/null)
  if [ -n "$r0" ]; then
    r1=$(pstart "$rp")
    [ -z "$r1" ] || [ "$r1" = "$r0" ] || return 1   # PID 재사용
  fi
  return 0
}

cmd_wait() {
  local id="${1:-}" max="$JOB_WAIT_MAX" jd st t0 rc pid ps0 ps1
  [ -n "$id" ] || usage
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --max) max="${2:-}"; shift 2 2>/dev/null || shift $# ;;
      --max=*) max="${1#--max=}"; shift ;;
      *) usage ;;
    esac
  done
  case "$max" in ''|*[!0-9]*) echo "사용법: heavy.sh wait <id> [--max <초 0~$JOB_WAIT_MAX>]" >&2; exit 2 ;; esac
  [ "$max" -le "$JOB_WAIT_MAX" ] || max="$JOB_WAIT_MAX"
  case "$id" in .*|*[!A-Za-z0-9._-]*) echo "HEAVY_JOB_UNKNOWN id=$id" >&2; exit 2 ;; esac
  jd="$JOBS/$id"
  [ -d "$jd" ] || { echo "HEAVY_JOB_UNKNOWN id=$id (잡 폴더 없음: $jd)" >&2; exit 2; }
  st=$(cat "$jd/start" 2>/dev/null); case "$st" in ''|*[!0-9]*) st=$(now) ;; esac
  t0=$(now)
  while :; do
    if [ -f "$jd/rc" ]; then
      tail -n 30 "$jd/log" 2>/dev/null
      rc=$(cat "$jd/rc" 2>/dev/null); case "$rc" in ''|*[!0-9]*) rc=1 ;; esac
      echo "HEAVY_JOB_DONE id=$id rc=$rc"
      # 잡 rc 75·76 을 그대로 exit 로 내면 wait 자신의 BUSY(75)·RUNNING(76) 규약과 겹친다 — 겹치지 않는 코드로 바꾼다
      case "$rc" in
        "$BUSY_RC")
          echo "HEAVY_JOB_BUSY id=$id rc=$rc — 분리된 자식이 슬롯을 끝내 못 얻었다(HEAVY_BUSY, 또는 명령이 75 로 끝남). 실패가 아니다 — 같은 명령을 다시 --detach 한다"
          exit "$JOB_BUSY_RC" ;;
        "$RUNNING_RC")
          echo "HEAVY_JOB_FAILED id=$id rc=$rc — 명령이 76 으로 끝났다(HEAVY_JOB_RUNNING 이 아니다 — 다시 wait 하지 않는다). 로그를 보고 판정한다"
          exit "$JOB_RC76_RC" ;;
      esac
      exit "$rc"
    fi
    # rc 없이 자식이 사라졌는가(SIGKILL·재부팅). pid 를 아직 못 읽으면 살아 있는 것으로 본다
    pid=$(cat "$jd/pid" 2>/dev/null)
    case "$pid" in
      ''|*[!0-9]*) ;;
      *)
        ps0=$(cat "$jd/pstart" 2>/dev/null); ps1=
        alive "$pid" && ps1=$(pstart "$pid")
        if ! alive "$pid" || { [ -n "$ps0" ] && [ -n "$ps1" ] && [ "$ps0" != "$ps1" ]; }; then
          [ -f "$jd/rc" ] && continue   # 그 사이에 rc 를 쓰고 끝났다
          # 잡만 사라지고 명령을 돌리는 손자 heavy.sh 가 살아 있으면 아직 도는 중이다(슬롯도 그 손자가 쥐고 있다) — RUNNING 으로 본다.
          # 손자가 끝나도 rc 를 쓸 잡이 없으므로 그때 LOST 가 된다.
          if job_run_alive "$jd"; then
            if [ $(( $(now) - t0 )) -ge "$max" ]; then
              echo "HEAVY_JOB_RUNNING id=$id elapsed=$(( $(now) - st ))s"
              exit "$RUNNING_RC"
            fi
            sleep "$POLL"; continue
          fi
          tail -n 30 "$jd/log" 2>/dev/null
          echo "HEAVY_JOB_LOST id=$id pid=$pid — rc 없이 끝났다(강제 종료 등). 로그를 보고 다시 돌린다"
          exit 1
        fi ;;
    esac
    if [ $(( $(now) - t0 )) -ge "$max" ]; then
      echo "HEAVY_JOB_RUNNING id=$id elapsed=$(( $(now) - st ))s"
      exit "$RUNNING_RC"
    fi
    sleep "$POLL"
  done
}

POOL=general; DETACH=0; EXCL=0
while :; do
  case "${1:-}" in
    --pool) POOL="${2:-}"; shift 2 2>/dev/null || shift $# ;;
    --pool=*) POOL="${1#--pool=}"; shift ;;
    --detach) DETACH=1; shift ;;
    --exclusive) EXCL=1; shift ;;
    *) break ;;
  esac
done
case "$POOL" in
  general|docker) ;;
  *) echo "사용법: heavy.sh --pool general|docker … (모르는 풀: $POOL)" >&2; exit 2 ;;
esac
if [ "$EXCL" = 1 ] && [ "$POOL" = docker ]; then
  echo "사용법: --exclusive 와 --pool docker 는 함께 쓰지 않는다" >&2; exit 2
fi
if [ "$POOL" = docker ] || [ "$EXCL" = 1 ] || [ "$DETACH" = 1 ]; then
  # 옵션은 명령 실행에만 붙는다
  case "${1:-}" in
    acquire|release|status|snapshot|wait|__job|'') echo "사용법: heavy.sh [--pool docker | --exclusive] [--detach] <명령> [인자…] (이 옵션은 명령 실행만 받는다)" >&2; exit 2 ;;
    --) shift; [ $# -ge 1 ] || usage ;;
  esac
fi
if [ "$DETACH" = 1 ]; then
  shown="$*"
  [ "$POOL" = general ] || set -- --pool "$POOL" "$@"
  [ "$EXCL" = 0 ] || set -- --exclusive "$@"
  cmd_detach "$shown" "$@"
fi
[ "$EXCL" = 0 ] || cmd_run_exclusive "$@"
[ "$POOL" = general ] || cmd_run_docker "$@"

case "${1:-}" in
  acquire) shift; cmd_acquire "$@" ;;
  release) shift; cmd_release ;;
  status)  cmd_status ;;
  snapshot) cmd_snapshot ;;
  wait)    shift; cmd_wait "$@" ;;
  __job)   shift; cmd_job "$@" ;;
  --)      shift; cmd_run "$@" ;;
  '')      usage ;;
  *)       cmd_run "$@" ;;
esac
