# 설계 상태 스펙 5판 상태 공간 모델 — 4판 모델(docs/superpowers/specs/2026-09-26-design-state-model.py, 7b4a29ac)을 복사해
# 5판(0a5d52a4) 규칙으로 고쳤다. 스펙 행 번호는 docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md(0a5d52a4) 기준.
#
# 바뀐 것(5판): 팀장 필터 없음(D27) · 설계 상태는 단계 ip 이상에서 고정, design_reopen 은 dd 에서만(D24, 4.1:135) ·
#   runner·runner_seen_at 과 mine·build-start 원자 조건(D25, 5.2:226, 5.3:265) · 3절 designScreen 11행(107-119) ·
#   4.1 사건 표 전체(128-145) · 5.2·5.3 · D13(142)·D14(143)·D26(130·218·253) · 6.2 이어가기 표(293-301) · 6.7(363-373)
#
# 실행: python3 model5.py [PASS=1|2] [FLAG=0|1 ...]   (6차 검토에서 돌린 판과 상태 수)
#   python3 model5.py PASS=1                                   → 145,242  (4판 모델과 같은 틀: 동시 워커 하나, 팀장 PC A 고정)
#   python3 model5.py PASS=1 MANUAL_DONE=1                     → 371,646  (④ 탐침: 사람의 수동 dflow.sh done)
#   python3 model5.py PASS=1 MANUAL_DONE=1 FIX_DONE_AT_IP=1    → 248,658  (수정안: 완료 보고는 ip 에서만 → ④ 0)
#   python3 model5.py PASS=1 IMPORT=1 MANUAL_PCT=1 BLOCKED=1 LEAD_MOVES=1  → 1,457,472
#   python3 model5.py PASS=2 SLIM=0 QUIET=0 LEAD_MOVES=0 IMPORT=0 MANUAL_PCT=0 BLOCKED=0 RELEASE_STOPS_WORKER=1 → 205,830 (PC 둘 동시 워커)
#   python3 model5.py PASS=2 SLIM=1 IMPORT=0 MANUAL_PCT=0 BLOCKED=0 RELEASE_STOPS_WORKER=1 → 167,084 (⑤ 축소판, 조용한 워커·팀장 이동 켬)
#   PASS=2 에 모든 기능을 켠 판은 3.8GB 를 넘어 끝나지 않았다(중단).
#   PASS=1 은 IMPORT·MANUAL_PCT·QUIET·BLOCKED·LEAD_MOVES 를 명령줄에서 켜지 않으면 끈다.
#   한계: PC 마다 워커는 하나라 같은 PC 의 두 세션(사람 체크아웃 + 팀장 워크트리)은 표현하지 못한다. 시간은 5분·30분·일시 제외 풀림 세 문턱뿐이다.
import itertools, collections, sys

V = dict(
    PASS=2,
    # --- 스펙이 정하지 않았으나 코드·스킬 문서가 정한 동작(근거 있음, 기본 켬) ---
    RESUME_PAST_BS=1,       # 재개 워커는 state.json phase 에서 이어 가며 build-start 는 Design 게이트 뒤에서만 부른다(dflow-dev SKILL.md 상태 모델, orch/start.md 끝줄, orch/design.md)
    GENERIC409_EXIT4=1,     # dflow.sh api_raw: code 가 cancelled 가 아닌 409 는 exit 4(=403 dependency_not_met 과 같음) → build-start 뒤 wait_pred 로 빠짐(orch/design.md 표)
    IMPORT=1,               # 0077 import_wbs_upsert 는 tags 를 덮어쓰고 주문을 취소하지 않는다. wbsImport.ensureOrdersForPayload 는 표식과 무관하게 갭에 ready 를 발행한다
    MANUAL_PCT=1,           # actions/wbs.ts:135-142 — 표식 없고 claimed·reported 가 아니면 사람이 실적 100 을 넣을 수 있다(ready 는 잠금 아님)
    QUIET=1,                # 살아 있는데 heartbeat 가 끊긴 워커(네트워크 끊김·절전·긴 명령). 30분 경계의 근거(D25 이유 칸)
    BLOCKED=1,              # 워커 질문(blocked) — seatState.ts:80 은 나이와 무관하게 BLOCKED
    LEAD_MOVES=1,           # 팀장이 다른 PC 로 옮겨 뜸(리스는 신원+프로젝트당 하나)
    MANUAL_DONE=0,          # 사람이 dflow.sh done 을 손으로 부름(W23 류) — ④ 탐침용, 켜면 다른 분석이 오염되므로 따로 돌린다
    OLD_KIT=0,              # 옛 킷 claim(legacy). 8절 킷 혼용 금지
    # --- 2단계 축소(⑤ 검사용): 사람 설계 고정(human 만 있음)·방식 고정·선행 met/ok·실패 결말은 죽음만 ---
    SLIM=0,
    RELEASE_STOPS_WORKER=0, # 1 이면 사람이 dflow.sh release 전에 워커를 멈춘다고 본다(고아 워커 경로를 뺀 순수 경로 확인용)
    # --- 스펙이 정하지 않은 동작(스위치) ---
    ASSIGN_SETS_AS=1,       # 4.1 위임: "→ as, 실적 0"(스펙). 0 이면 코드(0107 assign 은 stage 가 null 일 때만 as, ensureOrder 는 단계를 건드리지 않음)
    BS_PREDS_FIRST=0,       # build-start 안의 검사 순서: 0 = runner → 설계 → 선행(5.2 서술 순), 1 = 선행 403 을 runner 보다 먼저
    EXIT12_KEEP_WT=0,       # exit 12(runner_active) 뒤 워크트리를 남기나(6.7 미정)
    REOPEN_NONHUMAN_CLEARS_RUNNER=0,  # 비-human 되돌림이 runner 를 비우나(D25 목록에 없음)
    # --- 수정안 시험(기본 끔) ---
    FIX_TAKE_ON_RESUME=0,   # 모든 재개·재시작이 시작할 때 build-start 와 같은 원자 조건으로 runner 를 넘겨받는다(실패면 exit 12)
    FIX_HB_REPORT_RUNNER=0, # heartbeat·완료 보고가 호출 PC ≠ runner 면 409 runner_active(잃은 워커가 멈춘다)
    FIX_DONE_AT_IP=0,       # 완료 보고는 단계 ip 에서만(리프)
    FIX_CONFLICT_EXIT=0,    # 주문이 claimed 가 아닐 때의 409 를 exit 4 가 아닌 별도 exit 로(워커는 design_reopened 처럼 끝남)
    FIX_CLAIM_PCT100=0,     # claim 관문·5.3 3행이 D26 조건(실적 100) 전체를 본다
)
for a in ' '.join(sys.argv[1:]).split():
    k, v = a.split('=')
    V[k] = int(v)
if V['PASS'] == 1:
    for k in ('IMPORT', 'MANUAL_PCT', 'QUIET', 'BLOCKED', 'LEAD_MOVES'):
        if not any(a.startswith(k + '=') for a in sys.argv[1:]): V[k] = 0

PCS = ('A', 'B')  # PASS 1 도 사람의 다른 PC 수동 실행(4판 pc=other)은 둔다. 동시에 사는 워커 수만 1
MAXW = 2 if V['PASS'] == 2 else 1

CRED = {'as': 0, 'ds': 10, 'dd': 20, 'ip': 30, 'rw': 50, 'im': 80, 'xx': 100}
GE_IP = ('ip', 'im', 'xx')
ACTIVE = ('ready', 'claimed', 'reported')
F = collections.namedtuple('S', 'mode tag ord dst cs stage pct rw hbph hbage runner rage preds hd wA wB wtA wtB resA resB lead excl pend')
# ord: none ready claimed reported approved cancelled / dst: none review accepted / cs: None legacy full design build
# hbph: None work blocked wait(마지막 heartbeat phase) / hbage: 0 = 5분 이내, 1 = 5분 넘음(last_heartbeat_at)
# runner: None A B / rage: 0 = runner_seen_at 30분 이내, 1 = 30분 넘음
# preds: met ok no (ok = 미충족이 모두 dd·ip → 설계 선행 가능) / hd: 개발 브랜치에 사람 설계(5절 완비)
# wX: None 또는 (범위 full·design·build·rework·legacy, step 0=build-start 전·1=뒤, m run·quiet·blocked, own L=팀장 슬롯·H=사람)
# wtX: 그 PC 에 이 주문의 워크트리 / resX: 그 PC 의 마지막 워커 결말 None diedL diedH(결과 없이 죽음, 팀장 슬롯·사람) result / lead: 팀장이 뜬 PC
# excl: 팀장 제외 None temp perm / pend: agent 브랜치 tip 은 wait_review 인데 서버 설계 상태가 없음(design-done 유실)

def ge_ip(st): return st in GE_IP
def wof(s, X): return s.wA if X == 'A' else s.wB
def wtof(s, X): return s.wtA if X == 'A' else s.wtB
def resof(s, X): return s.resA if X == 'A' else s.resB
def setw(s, X, w=..., wt=..., res=...):
    kw = {}
    if w is not ...: kw['wA' if X == 'A' else 'wB'] = w
    if wt is not ...: kw['wtA' if X == 'A' else 'wtB'] = wt
    if res is not ...: kw['resA' if X == 'A' else 'resB'] = res
    return s._replace(**kw)
def running(w): return w is not None and w[2] == 'run'
def other(X): return 'B' if X == 'A' else 'A'

def norm(s):
    # 살아서 도는 워커는 heartbeat 를 계속 보낸다(훅). claimed 에서만 받는다(heartbeat/route.ts:82).
    if s.ord != 'claimed': return s
    if running(s.wA) or running(s.wB):
        s = s._replace(hbph='work', hbage=0)
    if s.runner is not None and running(wof(s, s.runner)):
        s = s._replace(rage=0)
    if s.runner is None and s.rage != 0:
        s = s._replace(rage=0)
    return s

def alive(s):  # 5.3 2행: ACTIVE(5분 이내, 대기 phase 아님) 또는 BLOCKED(나이 무관, seatState.ts:80)
    return s.hbph == 'blocked' or (s.hbph == 'work' and s.hbage == 0)

# ---- 5.3 판단(245-263) ----
def action(s):
    if s.ord in ('none',): return 'none'
    if s.ord in ('reported', 'approved', 'cancelled'): return 'skip'                  # 1
    if s.ord == 'claimed' and (ge_ip(s.stage) or alive(s)): return 'skip'            # 2
    if s.ord == 'ready' and (ge_ip(s.stage) or (V['FIX_CLAIM_PCT100'] and s.pct >= 100)): return 'skip'  # 3
    if s.dst == 'review': return 'wait'                                               # 4
    if s.dst == 'accepted' and s.stage != 'dd': return 'skip'                         # 5
    if s.dst == 'accepted' and s.preds != 'met': return 'wait'                        # 6
    if s.dst == 'accepted': return 'build'                                            # 7
    if s.ord == 'claimed':                                                            # 8
        if s.stage not in ('ds', 'dd'): return 'skip'
        c = s.cs or 'legacy'
        if c == 'design': return 'wait' if s.preds == 'no' else 'design'
        if c in ('full', 'legacy'):
            if (s.stage == 'dd' and s.preds != 'met') or s.preds == 'no': return 'wait'
            return 'full'
        return 'skip'
    if s.mode == 'human': return 'skip'                                               # 9
    if s.preds == 'no': return 'wait'                                                 # 10
    if s.mode == 'review': return 'design'                                            # 11
    return 'full'                                                                     # 12

def mine(s, X, lead):  # 5.3 265-266, D25. ready 는 작업 목록 기준(팀장은 agent 표식 거르기, 사람 수동 실행은 표식 무관)
    if s.ord == 'ready': return s.tag if lead else True
    if s.ord == 'claimed': return s.runner is None or s.runner == X or s.rage == 1
    return False

# ---- 5.2 관문(215-241) ----
def can_claim(s, scope, df):
    if ge_ip(s.stage): return ('409', 'stage')                                        # 218
    if V['FIX_CLAIM_PCT100'] and s.pct >= 100: return ('409', 'stage')
    if scope in ('full', 'legacy'):
        if not (s.mode == 'auto' and s.dst == 'none'): return ('409', 'design_gate')  # 222
    elif scope == 'design':
        if not (s.mode in ('auto', 'review') and s.dst == 'none'): return ('409', 'design_gate')  # 223
        df = s.preds != 'met'
    elif scope == 'build':
        if not (s.mode == 'human' and s.dst == 'accepted' and s.stage == 'dd'): return ('409', 'design_not_accepted')  # 224
        df = False
    if s.preds != 'met':                                                              # claim 라우트 67-89, D15
        if not df: return ('403', 'dependency_not_met')
        if s.preds == 'no': return ('403', 'design_first_too_early')
    return None

def can_build_start(s, scope, X):
    if s.ord != 'claimed': return ('409', 'conflict')                                 # build-start/route.ts:36
    def runner_ok(): return s.runner is None or s.runner == X or s.rage == 1          # 226-227
    def preds_block(): return (not ge_ip(s.stage)) and s.preds != 'met'               # 236
    if V['BS_PREDS_FIRST'] and preds_block(): return ('403', 'dependency_not_met')
    if not runner_ok(): return ('409', 'runner_active')
    c = s.cs or 'legacy'
    if scope == 'legacy' and not ge_ip(s.stage): scope = 'full'                       # 234
    if scope == 'full':                                                               # 231
        if not (s.mode == 'auto' and s.dst == 'none' and c in ('full', 'legacy')): return ('409', 'design_gate')
        if s.stage not in ('ds', 'dd') and not ge_ip(s.stage): return ('409', 'design_gate')
    elif scope == 'build':                                                            # 232
        if s.dst != 'accepted': return ('409', 'design_not_accepted')
        if s.stage != 'dd' and not ge_ip(s.stage): return ('409', 'design_gate')
    elif scope == 'rework':                                                           # 233
        if not (s.dst != 'review' and s.stage == 'ip'): return ('409', 'design_gate')
    elif scope == 'legacy':                                                           # 234
        if s.dst == 'review': return ('409', 'design_gate')
    if preds_block(): return ('403', 'dependency_not_met')
    return None

def mx(p, key): return max(p, CRED[key])                                              # D19
VIOL = []
def viol(kind, s, lbl): VIOL.append((kind, s, lbl))

def wscope_from_cs(s):                                                                # D21
    c = s.cs or 'legacy'
    return {'design': 'design', 'full': 'full', 'legacy': 'full', 'build': 'build'}[c]

def unapproved(s):  # 승인되지 않은 설계: review 이거나, review·human 방식인데 accepted 가 아님
    return s.dst == 'review' or (s.mode in ('review', 'human') and s.dst != 'accepted')

# ---- 4.1 사건 ----
def issue(t):  # D26 발행(위임·import·백필 공통)
    if t.ord in ACTIVE or t.ord == 'approved' or ge_ip(t.stage) or t.pct >= 100: return t
    st, p = (('as', 0) if V['ASSIGN_SETS_AS'] else (t.stage, t.pct))
    return t._replace(ord='ready', dst='none', cs=None, stage=st, pct=p, rw=False, hbph=None, hbage=0, runner=None, rage=0,
                      wA=None, wB=None, wtA=False, wtB=False, resA=None, resB=None, excl=None, pend=False)

def cancel(t):  # D14
    if t.ord not in ('ready', 'claimed'): return t
    st, p = t.stage, t.pct
    if t.ord == 'claimed' or t.stage == 'dd': st, p = 'as', 0
    return t._replace(ord='cancelled', dst='none', cs=None, runner=None, rage=0, stage=st, pct=p, rw=False, hbph=None, hbage=0,
                      wA=None, wB=None, wtA=False, wtB=False, resA=None, resB=None, pend=False)

def reopen(s):  # 4.1 135: dd ∧ accepted 에서만
    if not (s.stage == 'dd' and s.dst == 'accepted'): return None
    if s.mode == 'human':
        t = s._replace(stage='as', dst='none', pct=0)
        if s.ord == 'claimed':
            t = t._replace(ord='ready', cs=None, runner=None, rage=0, hbph=None, hbage=0, pend=False)  # 워커는 고아로 남는다
        return t
    t = s._replace(dst='review')
    if V['REOPEN_NONHUMAN_CLEARS_RUNNER']: t = t._replace(runner=None, rage=0)
    return t

def design_done(s, caller):  # 4.1 132
    if s.ord != 'claimed' or s.stage not in ('ds', 'dd'): return None
    dst = s.dst
    became_review = False
    if dst == 'none' and (s.mode == 'review' or s.cs == 'design'): dst, became_review = 'review', True
    t = s._replace(stage='dd', dst=dst, pct=mx(s.pct, 'dd'), hbph='wait', hbage=0, pend=False)
    if became_review: t = t._replace(runner=None, rage=0)
    return t

def claim(s, sc, df, X, own):
    if sc in ('full', 'design'): st, key = 'ds', 'ds'
    elif sc == 'build': st, key = 'dd', 'dd'
    else: st, key = (('ds', 'ds') if df else ('ip', 'ip'))
    t = s._replace(ord='claimed', cs=sc, stage=st, pct=mx(s.pct, key), runner=X, rage=0, hbph='work', hbage=0, rw=False, pend=False)
    if own == 'L': t = t._replace(excl=None)
    return setw(t, X, w=(sc, 0, 'run', own), wt=True, res=None)

def resume_variants(s, X, own):
    ws = wscope_from_cs(s)
    if s.rw and s.stage == 'ip': ws = 'rework'
    steps = (0, 1) if (ge_ip(s.stage) and ws != 'rework' and V['RESUME_PAST_BS']) else (0,)
    out = []
    for st in steps:
        t = setw(s, X, w=(ws, st, 'run', own), wt=True, res=None)
        if V['FIX_TAKE_ON_RESUME']:
            if not (s.runner is None or s.runner == X or s.rage == 1):
                out.append((ws, st, setw(s, X, res='result')))  # take 실패 → exit 12
                continue
            t = t._replace(runner=X, rage=0)
        out.append((ws, st, t))
    return out

def end_worker(t, X, res, wt=..., excl=None, own='L'):
    t = setw(t, X, w=None, res=res, **({} if wt is ... else {'wt': wt}))
    if own == 'L' and excl is not None and t.lead == X:
        t = t._replace(excl=excl)
    return t

SPAWN = '★'  # 팀장이 워커를 띄운 전이 표지(고리 검사용)

def transitions(s):
    out = []
    def add(lbl, t, kind):
        if t is None: return
        if V['SLIM'] and kind == 'wfail': return
        t = norm(t)
        if t != s: out.append((lbl, t, kind))
    # ================= 사람(웹 버튼·표식·방식) =================
    if not s.tag:
        add('위임 켬', issue(s._replace(tag=True)), 'human')
    else:
        add('위임 해제·중단', cancel(s._replace(tag=False)), 'human')
    if s.dst == 'none' and s.ord not in ('claimed', 'reported', 'approved') and not V['SLIM']:  # 4.1 144
        for m in ('auto', 'review', 'human'):
            if m != s.mode: add(f'방식 {m}', s._replace(mode=m), 'human')
    if s.ord == 'claimed' and s.dst == 'review' and s.stage == 'dd':                   # ①
        add('설계 승인①', s._replace(dst='accepted', cs='build'), 'human')
    if s.ord == 'ready' and s.mode == 'human' and s.tag and s.stage in ('as', 'ds') and s.dst == 'none':  # ②
        t = s._replace(stage='dd', dst='accepted', pct=mx(s.pct, 'dd'))
        if t.pct < s.pct: viol('I6 실적 역행', s, '설계 확정')
        add('설계 확정②', t, 'human')
    if s.stage == 'dd' and s.dst == 'accepted':
        add('설계 되돌리기(사람)', reopen(s), 'human')
    if s.ord == 'reported':
        add('승인', s._replace(ord='approved', stage='xx', pct=100), 'human')
        add('반려', s._replace(ord='claimed', stage='ip', pct=CRED['rw'], rw=True, hbph='work', hbage=1, runner=None, rage=0), 'human')
    if s.ord == 'approved':
        add('재작업', s._replace(ord='claimed', stage='ip', pct=CRED['rw'], rw=True, hbph='work', hbage=1, runner=None, rage=0), 'human')
        add('승인 취소', s._replace(ord='reported', stage='im', pct=80), 'human')
    if not V['SLIM']: add('사람 설계 토글', s._replace(hd=not s.hd), 'human')
    # ================= 사람(그 밖: set_stage·수기 실적·import) =================
    if not s.tag and s.ord not in ('claimed', 'reported'):
        for st in ('as', 'ds', 'ip', 'im', 'xx'):
            add(f'set_stage {st}', s._replace(stage=st, pct=CRED[st]), 'human2')
        if V['MANUAL_PCT'] and s.pct != 100:
            add('실적 100 수기 입력', s._replace(pct=100), 'human2')
    if V['IMPORT']:
        for tv in (True, False):
            t = issue(s._replace(tag=tv))
            add(f'import(표식 {"켬" if tv else "끔"}, 갭 발행)', t, 'human2')
    # ================= 사람(CLI) =================
    if s.ord == 'claimed' and s.dst == 'none' and (s.cs != 'design' or s.stage not in ('ds', 'dd')):  # D13
        t = s._replace(ord='ready', stage='as', pct=0, cs=None, runner=None, rage=0, hbph=None, hbage=0, pend=False, rw=False)
        if V['RELEASE_STOPS_WORKER']: t = t._replace(wA=None, wB=None)
        add('release(dflow.sh)', t, 'cli')
    nlive = (s.wA is not None) + (s.wB is not None)
    for X in PCS:
        if wof(s, X) is not None or nlive >= MAXW: continue
        if s.ord == 'ready':
            for sc in ('full', 'design', 'build'):
                if sc == 'design' and s.hd: continue          # 6.3 claim 전 확인 → skipped
                if sc == 'build' and not s.hd: continue       # start.md 구현부터 1·2 → 착수 안 함
                df = (sc == 'full' and s.preds != 'met')
                if can_claim(s, sc, df) is None:
                    add(f'수동 /dflow-dev --scope {sc}@{X}', claim(s, sc, df, X, 'H'), 'cli')
            if V['OLD_KIT'] and can_claim(s, 'legacy', s.preds != 'met') is None:
                add(f'옛 킷 claim@{X}', claim(s, 'legacy', s.preds != 'met', X, 'H'), 'cli')
        elif s.ord == 'claimed' and mine(s, X, lead=False):
            for ws, st, t in resume_variants(s, X, 'H'):
                add(f'수동 --resume@{X}(워커 {ws}, {"build-start 뒤 phase" if st else "게이트부터"})', t, 'cli')
    if V['MANUAL_DONE'] and s.ord == 'claimed':
        r = s.dst != 'review' and (not V['FIX_DONE_AT_IP'] or s.stage == 'ip')
        if r:
            if unapproved(s): viol('I4 완료 보고(미승인 설계)', s, '수동 dflow.sh done')
            add('수동 dflow.sh done', s._replace(ord='reported', stage='im', pct=mx(s.pct, 'im'), runner=None, rage=0, rw=False), 'cli')
    # ================= 환경 =================
    for p in (('met', 'ok') if V['SLIM'] else ('met', 'ok', 'no')):
        if p != s.preds: add(f'선행 {p}', s._replace(preds=p), 'preds')
    if s.ord == 'claimed':
        if not (running(s.wA) or running(s.wB)) and s.hbage == 0 and s.hbph in ('work', 'wait', 'blocked'):
            add('5분 경과', s._replace(hbage=1), 'time')
        if s.runner is not None and s.rage == 0 and not running(wof(s, s.runner)):
            t = s._replace(rage=1)
            if not (running(s.wA) or running(s.wB)): t = t._replace(hbage=1)
            add('30분 경과(도는 PC 조용)', t, 'time')
    if s.excl == 'temp': add('일시 제외 풀림', s._replace(excl=None), 'time')
    if V['LEAD_MOVES']:
        add('팀장이 다른 PC 에서 뜸', s._replace(lead=other(s.lead), excl=None), 'env')
    # ================= 팀장(s.lead) =================
    L = s.lead
    if s.excl is None and wof(s, L) is None and nlive < MAXW:
        a = action(s)
        m = mine(s, L, lead=True)
        if s.ord == 'ready' and a in ('full', 'design', 'build') and m:
            if a == 'build' and s.mode == 'human' and not s.hd:                       # 6.2 284
                add('팀장 띄우기 전 검사 → design-reopen', reopen(s), 'lead')
            elif a == 'design' and s.hd:                                              # 6.2 285
                add('팀장 띄우기 전 검사 → 멈춤(30분 제외)', s._replace(excl='temp'), 'lead')
            elif wtof(s, L):
                add(SPAWN + '팀장 spawn → worktree add 실패(남은 워크트리)', s._replace(excl='perm'), 'lead')
            else:
                df = (a == 'full' and s.preds != 'met')
                r = can_claim(s, a, df)
                if r is not None:
                    viol('I1 claim 거부', s, f'팀장 action={a} → {r}')
                    add(SPAWN + f'팀장 spawn {a} → claim 거부', s._replace(excl='temp'), 'lead')
                else:
                    add(SPAWN + f'팀장 spawn {a}', claim(s, a, df, L, 'L'), 'lead')
        elif s.ord == 'claimed' and m:
            if a == 'skip':
                row2 = ge_ip(s.stage) or alive(s)
                if row2 and wtof(s, L) and resof(s, L) == 'diedL':                    # 6.2 297 — 결과 없이 죽은 이 PC 의 팀장 슬롯 워커
                    for ws, st, t in resume_variants(s, L, 'L'):
                        add(SPAWN + f'팀장 재시작 규칙(워커 {ws}, {"build-start 뒤 phase" if st else "게이트부터"})', t, 'lead')
            elif a in ('full', 'design', 'build'):                                    # 6.2 300-301
                ws = wscope_from_cs(s)
                if s.rw and s.stage == 'ip': ws = 'rework'
                if ws != a: viol('I1 범위 불일치', s, f'팀장 action={a} 워커 claim_scope→{ws}')
                for ws2, st, t in resume_variants(s, L, 'L'):
                    add(SPAWN + f'팀장 재개({"같은 워크트리" if wtof(s, L) else "5-1 새 워크트리"}, 워커 {ws2})', t, 'lead')
    # 팀장 결과 처리·재시작 복구: 끝나지 않은 설계 멈춤 이어받기(6.3 320-322)
    if s.pend and s.ord == 'claimed' and s.dst == 'none' and wtof(s, L) and wof(s, L) is None:
        t = design_done(s, L)
        if t is not None: add('팀장 멈춤 이어받기 → design-done', setw(t, L, wt=False), 'lead')
    # ================= 워커 =================
    for X in PCS:
        w = wof(s, X)
        if w is None: continue
        sc, step, m, own = w
        if s.ord == 'cancelled':
            add(f'워커@{X} exit 10(중단됨) 멈춤', end_worker(s, X, 'result', own=own), 'worker')
            continue
        if s.ord != 'claimed':
            # 고아: 다음 서버 호출이 409 conflict
            if V['FIX_CONFLICT_EXIT']:
                add(f'워커@{X} 고아 → 주문 되돌려짐으로 끝남', end_worker(s, X, 'result', wt=False, own=own), 'worker')
            else:
                add(f'워커@{X} 고아 → 409 conflict=exit 4 → wait_pred → design-done 거부 → failed(영구 제외)',
                    end_worker(s, X, 'result', excl='perm', own=own), 'worker')
            continue
        add(f'워커@{X} 죽음', end_worker(s, X, 'died' + own, own=own), 'wdie')
        if V['QUIET'] and m in ('run', 'quiet'):
            add(f'워커@{X} {"조용해짐" if m == "run" else "다시 신호"}', setw(s, X, w=(sc, step, 'quiet' if m == 'run' else 'run', own)), 'env')
        if V['BLOCKED']:
            if m == 'run':
                t = setw(s, X, w=(sc, step, 'blocked', own))._replace(hbph='blocked', hbage=0)
                if s.runner == X: t = t._replace(rage=0)
                add(f'워커@{X} 질문(blocked)', t, 'env')
            if m == 'blocked':
                add(f'워커@{X} 답 받음', setw(s, X, w=(sc, step, 'run', own)), 'env')
        if m != 'run': continue
        if V['FIX_HB_REPORT_RUNNER'] and s.runner is not None and s.runner != X and not (s.rage == 1):
            add(f'워커@{X} heartbeat 409 runner_active → 멈춤', end_worker(s, X, 'result', own=own), 'worker')
            continue
        if sc == 'design':
            if s.stage in ('ds', 'dd') and s.dst in ('none', 'review'):
                t = design_done(s, X)
                add(f'워커@{X} 설계만 멈춤(push·design-done)', end_worker(t, X, 'result', wt=False, own=own), 'worker')
                if not s.pend:
                    add(f'워커@{X} push 실패 → failed(영구 제외)', end_worker(s, X, 'result', excl='perm', own=own), 'wfail')
                    add(f'워커@{X} design-done 네트워크 실패 → design_review(미확인)', end_worker(s._replace(pend=True), X, 'result', own=own), 'wfail')
            continue
        if step == 0:
            if sc == 'build' and s.stage == 'dd':
                add(f'워커@{X} fetch 실패 → failed(영구 제외)', end_worker(s, X, 'result', excl='perm', own=own), 'wfail')
                if s.mode == 'human' and not s.hd:                                    # 6.4 333
                    add(f'워커@{X} 게이트 불통 → design-reopen(human)', end_worker(reopen(s), X, 'result', wt=False, own=own), 'worker')
                elif s.mode != 'human' and s.dst == 'accepted':
                    add(f'워커@{X} 게이트 불통·선행 계약 바뀜 → design-reopen(review)', end_worker(reopen(s), X, 'result', wt=False, own=own), 'wfail')
            if sc in ('build', 'full', 'legacy') and ge_ip(s.stage):
                add(f'워커@{X} 재개 게이트 불통(구현 중) → failed(영구 제외)', end_worker(s, X, 'result', excl='perm', own=own), 'wfail')
            r = can_build_start(s, sc, X)
            if r is None:
                t = s
                if s.stage in ('ds', 'dd'):
                    t = t._replace(stage='ip', pct=mx(s.pct, 'ip'))
                    if t.pct < s.pct: viol('I6 실적 역행', s, 'build-start')
                t = t._replace(runner=X, rage=0)
                if unapproved(s): viol('I4 build-start 통과(미승인 설계)', s, f'워커@{X} {sc}')
                wo = wof(s, other(X))
                if wo is not None and wo[1] == 1: viol('I5 build-start 통과(다른 PC 워커가 구현 중)', s, f'워커@{X} {sc}')
                add(f'워커@{X} build-start {sc} 통과', setw(t, X, w=(sc, 1, 'run', own)), 'worker')
            elif r[0] == '403':
                t = design_done(s, X)
                if t is None: t = s
                if s.runner is not None and s.runner != X and s.rage == 0:
                    viol('I7 비-runner 워커가 design-done(wait) 로 살아 있는 runner 를 죽은 것처럼 만듦', s, f'워커@{X}')
                add(f'워커@{X} build-start 403 → wait_pred(design-done)', end_worker(t, X, 'result', own=own), 'worker')
            elif r[1] == 'runner_active':
                add(f'워커@{X} build-start 409 runner_active → exit 12 skipped',
                    end_worker(s, X, 'result', excl='temp', own=own, **({} if V['EXIT12_KEEP_WT'] else {'wt': False})), 'worker')
            elif r[1] == 'conflict':
                pass
            else:
                add(f'워커@{X} build-start 409 {r[1]} → exit 11 skipped', end_worker(s, X, 'result', excl='temp', wt=False, own=own), 'worker')
        else:  # step 1: 구현 중
            ok = s.dst != 'review'
            if V['FIX_DONE_AT_IP'] and s.stage != 'ip': ok = False
            if V['FIX_HB_REPORT_RUNNER'] and s.runner is not None and s.runner != X: ok = False
            if ok:
                if unapproved(s): viol('I4 완료 보고(미승인 설계)', s, f'워커@{X} {sc}')
                wo = wof(s, other(X))
                if wo is not None and wo[1] == 1 and s.ord == 'claimed':
                    viol('I5 완료 보고(다른 PC 워커도 build-start 뒤)', s, f'워커@{X} {sc}' + (' (보고자가 runner 아님)' if s.runner != X else ''))
                t = s._replace(ord='reported', stage='im', pct=mx(s.pct, 'im'), runner=None, rage=0, rw=False)
                add(f'워커@{X} 완료 보고', end_worker(t, X, 'result', own=own), 'worker')
            add(f'워커@{X} 설계 변경 필요·게이트 불통 → failed(영구 제외)', end_worker(s, X, 'result', excl='perm', own=own), 'wfail')
    return out

# ---- 3절 designScreen(107-119) ----
def screen(s):
    pm = s.preds == 'met'
    if s.ord == 'claimed' and s.dst == 'review': return 1
    if s.dst == 'accepted' and s.stage == 'dd' and not pm: return 2
    if s.dst == 'accepted' and s.stage == 'dd': return 3
    if s.ord == 'claimed' and s.dst == 'none' and s.stage == 'dd': return 4
    if s.ord == 'claimed' and s.stage == 'ip' and s.rw: return 5
    if s.mode == 'human' and s.stage in ('as', 'ds') and s.dst == 'none' and s.tag and s.ord == 'ready': return 6
    if s.mode == 'human' and s.stage in ('as', 'ds') and s.dst == 'none': return 7
    if s.tag and s.ord == 'ready' and ge_ip(s.stage): return 8
    if s.tag and s.ord not in ACTIVE and s.ord == 'approved' and s.stage != 'xx': return 9
    if s.tag and s.ord not in ACTIVE and s.ord != 'approved' and (ge_ip(s.stage) or s.pct == 100): return 10
    if s.mode == 'review' and s.ord == 'ready' and s.dst == 'none' and s.preds == 'no': return 11
    return 0
SCREEN_TXT = {0: '단계 문구', 1: '설계 검토 대기', 2: '선행 대기(설계 승인·확정됨)', 3: '구현 대기(설계 승인·확정됨)', 4: '설계 완료·선행/구현 대기',
              5: '재작업 대기', 6: '사람 설계 대기+확정', 7: '사람 설계 대기(위임 안 됨)', 8: '위임 보류(진행됨)', 9: '위임 보류(승인된 주문)',
              10: '위임 보류(진행됨)', 11: '선행 대기'}
def buttons(s):
    b = []
    if s.ord == 'claimed' and s.dst == 'review' and s.stage == 'dd': b.append('설계 승인')
    if s.ord == 'ready' and s.mode == 'human' and s.tag and s.stage in ('as', 'ds') and s.dst == 'none': b.append('설계 확정')
    if s.stage == 'dd' and s.dst == 'accepted': b.append('설계 되돌리기')
    return b

def initial():
    for mode in ('auto', 'review', 'human'):
        for ordv in ('none', 'ready'):
            yield F(mode, False, ordv, 'none', None, 'as', 0, False, None, 0, None, 0, 'met', bool(V['SLIM'] and mode == 'human'),
                    None, None, False, False, None, None, 'A', None, False)

def bfs():
    par = {}
    q = collections.deque()
    for s in initial():
        par[s] = (None, 'init')
        q.append(s)
    edges = {}
    while q:
        s = q.popleft()
        outs = transitions(s)
        edges[s] = outs
        for lbl, t, kind in outs:
            if t not in par:
                par[t] = (s, lbl)
                q.append(t)
    return par, edges

def path(par, s):
    seq = []
    while s is not None:
        p, l = par[s]
        seq.append(l)
        s = p
    return list(reversed(seq))

def fmt(s):
    def fw(w): return '-' if w is None else f'{w[0]}/{w[1]}/{w[2]}/{w[3]}'
    return (f'mode={s.mode} tag={int(s.tag)} ord={s.ord} dst={s.dst} cs={s.cs} stage={s.stage} pct={s.pct} rw={int(s.rw)} '
            f'hb={s.hbph}/{s.hbage} runner={s.runner}/{"stale" if s.rage else "fresh"} preds={s.preds} hd={int(s.hd)} '
            f'wA={fw(s.wA)} wB={fw(s.wB)} wt={int(s.wtA)}{int(s.wtB)} res={s.resA}/{s.resB} lead={s.lead} excl={s.excl} pend={int(s.pend)}')

# ---- 정적 검사: 도달 상태마다 판단↔관문(①) ----
def static_checks(par):
    bad = []
    for s in par:
        a = action(s)
        for X in PCS:
            if a not in ('full', 'design', 'build') or not mine(s, X, lead=True): continue
            if s.ord == 'ready':
                if a == 'build' and s.mode == 'human' and not s.hd: continue
                if a == 'design' and s.hd: continue
                df = (a == 'full' and s.preds != 'met')
                r = can_claim(s, a, df)
                if r is not None: bad.append(('① ready: action→claim 거부', s, X, a, r))
            elif s.ord == 'claimed':
                ws = wscope_from_cs(s)
                if s.rw and s.stage == 'ip': ws = 'rework'
                if ws != a: bad.append(('① claimed: action≠claim_scope 범위', s, X, a, ws)); continue
                if ws == 'design':
                    if s.stage not in ('ds', 'dd'): bad.append(('① claimed design: design-done 불가 단계', s, X, a, s.stage))
                    continue
                r = can_build_start(s, ws, X)
                if r is not None and not (r[0] == '403' and a == 'full'):
                    bad.append(('① claimed: action→build-start 거부', s, X, a, r))
    return bad

def reach_back(states, edges, goal_pred, allowed):
    rev = collections.defaultdict(set)
    for s, outs in edges.items():
        for lbl, t, kind in outs:
            if allowed(s, lbl, kind): rev[t].add(s)
    goal = [s for s in states if goal_pred(s)]
    seen = set(goal); q = collections.deque(goal)
    while q:
        t = q.popleft()
        for s in rev[t]:
            if s not in seen: seen.add(s); q.append(s)
    return seen

def tarjan_scc(nodes, succ):
    index = {}; low = {}; onst = set(); st = []; res = []; idx = [0]
    sys.setrecursionlimit(1000000)
    for v0 in nodes:
        if v0 in index: continue
        stack = [(v0, iter(succ(v0)))]
        index[v0] = low[v0] = idx[0]; idx[0] += 1; st.append(v0); onst.add(v0)
        while stack:
            v, it = stack[-1]
            nxt = next(it, None)
            if nxt is not None:
                w = nxt
                if w not in index:
                    index[w] = low[w] = idx[0]; idx[0] += 1; st.append(w); onst.add(w)
                    stack.append((w, iter(succ(w))))
                elif w in onst:
                    low[v] = min(low[v], index[w])
            else:
                stack.pop()
                if stack:
                    u = stack[-1][0]; low[u] = min(low[u], low[v])
                if low[v] == index[v]:
                    comp = []
                    while True:
                        w = st.pop(); onst.discard(w); comp.append(w)
                        if w == v: break
                    res.append(comp)
    return res

def main():
    par, edges = bfs()
    states = list(par)
    print('변형:', {k: v for k, v in V.items()})
    print('도달 상태 수:', len(states))
    # 차원 축소 판(4판의 9차원 요약과 맞춰 보기 위함)
    dims = set((s.mode, s.tag, s.ord, s.dst, s.cs, s.stage, s.rw, s.preds, s.hd) for s in states)
    print('9차원(mode tag ord dst cs stage rw preds hd) 조합 수:', len(dims))
    # ---- 위반(전이 중) ----
    best = {}
    for k, s, l in VIOL:
        kk = (k, l)
        p = path(par, s) if s in par else ['(미도달)']
        if kk not in best or len(p) < len(best[kk][1]): best[kk] = (s, p)
    print(f'\n## 전이 중 위반 {len(best)} 종')
    for (k, l), (s, p) in sorted(best.items(), key=lambda x: (x[0][0], len(x[1][1]))):
        print(f'\n[{k}] {l}\n  상태: {fmt(s)}\n  경로({len(p)}): ' + ' → '.join(p))
    # ---- ⑤ 두 워커 구현 ----
    both = [s for s in states if s.ord == 'claimed' and s.wA is not None and s.wB is not None and s.wA[1] == 1 and s.wB[1] == 1]
    print(f'\n## ⑤ 두 워커가 같은 주문에서 build-start 뒤(구현 중): {len(both)} 상태')
    if both:
        ex = min(both, key=lambda s: len(path(par, s)))
        print('  최단 예: ' + fmt(ex)); print('  경로: ' + ' → '.join(path(par, ex)))
        # 사람 --resume·재시작을 나눠 본다
        groups = collections.Counter()
        exs = {}
        for s in both:
            p = path(par, s)
            j = ' '.join(p)
            key = ('release' in j or '설계 되돌리기' in j, 'build-start 뒤 phase' in j, '30분' in j, '조용해짐' in j, '재시작 규칙' in j)
            groups[key] += 1
            if key not in exs or len(p) < len(exs[key]): exs[key] = p
        for key, n in groups.most_common():
            print(f'  묶음(release·되돌리기 고아={key[0]}, build-start 없는 재개={key[1]}, 30분={key[2]}, 조용한 워커={key[3]}, 재시작 규칙={key[4]}): {n}')
            print('    예: ' + ' → '.join(exs[key]))
    pre = [s for s in states if s.ord == 'claimed' and s.wA is not None and s.wB is not None and (s.wA[1] == 0 or s.wB[1] == 0)]
    print(f'  (참고) 두 워커 동시(적어도 하나는 build-start 전, 11절이 인정한 겹침): {len(pre)} 상태')
    # ---- ① 정적 ----
    bad = static_checks(par)
    print(f'\n## ① 판단(5.3)·mine → 관문(5.2) 어긋남(정적, 도달 상태 × PC): {len(bad)}')
    shown = {}
    for k, s, X, a, r in bad:
        key = (k, a, str(r))
        p = path(par, s)
        if key not in shown or len(p) < len(shown[key][1]): shown[key] = (s, p, X)
    for (k, a, r), (s, p, X) in shown.items():
        print(f'  [{k}] action={a} → {r} @PC {X}\n    상태: {fmt(s)}\n    경로: ' + ' → '.join(p))
    return par, edges

def analyze(par, edges):
    states = list(par)
    goal = lambda s: s.ord == 'approved'
    R_all = reach_back(states, edges, goal, lambda s, l, k: True)
    R_nocancel = reach_back(states, edges, goal, lambda s, l, k: not l.startswith('위임 해제·중단'))
    # 안내된 행동: 웹 버튼·표식·방식, 팀장·워커·시간·환경, 그리고 화면 5행(재작업 대기)이 안내하는 사람의 /dflow-dev
    R_guided = reach_back(states, edges, goal, lambda s, l, k: (k in ('human', 'lead', 'worker', 'wfail', 'wdie', 'time', 'env', 'preds')
                          or (k == 'cli' and screen(s) == 5 and l.startswith('수동 --resume'))) and not l.startswith('위임 해제·중단'))
    cats = collections.defaultdict(list)
    for s in states:
        if s.ord in ('none', 'cancelled') and not s.tag: continue
        if s not in R_all: cats['a 완료로 가는 길 없음'].append(s)
        elif s not in R_nocancel and screen(s) not in (8, 9, 10): cats['b 「중단」을 거쳐야만(화면이 위임 해제를 안내하는 8~10행 제외)'].append(s)
        elif s not in R_guided: cats['c 화면이 안내하는 행동·자동만으로는 못 감(CLI·set_stage·import·수기 실적 필요)'].append(s)
    for k in sorted(cats):
        lst = cats[k]
        print(f'\n## ② {k}: {len(lst)} 상태')
        groups = collections.Counter((s.mode, s.tag, s.ord, s.dst, s.cs, s.stage, s.rw, s.preds) for s in lst)
        for g, n in groups.most_common(25):
            ex = min((s for s in lst if (s.mode, s.tag, s.ord, s.dst, s.cs, s.stage, s.rw, s.preds) == g), key=lambda s: len(path(par, s)))
            print(f'  {n:6d} mode={g[0]} tag={int(g[1])} ord={g[2]} dst={g[3]} cs={g[4]} stage={g[5]} rw={int(g[6])} preds={g[7]} | 화면={SCREEN_TXT[screen(ex)]} 버튼={buttons(ex)}')
            print('         예: ' + fmt(ex)); print('         경로: ' + ' → '.join(path(par, ex)))
    return R_all, R_nocancel, R_guided

def loops(par, edges):
    # 자동만(팀장·워커 정상 결말·시간·제외 풀림)의 부분 그래프에서 spawn 을 품은 강연결 성분
    auto_kinds = ('lead', 'worker', 'time')
    def succ(s):
        return [t for (l, t, k) in edges.get(s, ()) if k in auto_kinds and t in par]
    comps = tarjan_scc(list(par), succ)
    found = collections.Counter(); ex = {}
    for comp in comps:
        if len(comp) < 2: continue
        cs = set(comp)
        labels = set()
        for s in comp:
            for (l, t, k) in edges.get(s, ()):
                if k in auto_kinds and t in cs: labels.add(l.split('@')[0].split('(')[0])
        if not any(l.startswith(SPAWN) or l.startswith('팀장') for l in labels): continue
        s0 = comp[0]
        key = (s0.mode, s0.ord, s0.dst, s0.cs, s0.stage, s0.hd, s0.preds, tuple(sorted(labels)))
        found[key] += 1
        if key not in ex or len(path(par, s0)) < len(path(par, ex[key])): ex[key] = s0
    print(f'\n## ② 자동 전이(팀장·워커 정상 결말·시간)만으로 도는 고리(팀장 행동 포함, ★=워커 spawn): {len(found)} 종')
    for key, n in found.most_common(30):
        s0 = ex[key]
        print(f'  {n:5d} mode={key[0]} ord={key[1]} dst={key[2]} cs={key[3]} stage={key[4]} hd={int(key[5])} preds={key[6]}')
        print('        고리 전이: ' + ' | '.join(key[7]))
        print('        예: ' + fmt(s0)); print('        경로: ' + ' → '.join(path(par, s0)))

def time_closure(s, edges, par):
    seen = {s}; q = [s]
    while q:
        u = q.pop()
        for (l, t, k) in edges.get(u, ()):
            if k == 'time' and t in par and t not in seen:
                seen.add(t); q.append(t)
    return seen

def silent(par, edges):
    # 산 워커 없음, 시간이 흘러도(5분·30분·제외 풀림) 팀장이 움직이지 않음, 화면이 사람 할 일을 안내하지 않음
    out = collections.defaultdict(list)
    for s in par:
        if s.wA is not None or s.wB is not None: continue
        if s.ord not in ('ready', 'claimed'): continue
        if not s.tag and s.ord == 'ready': continue
        if s.preds != 'met': continue
        if any(k == 'lead' for u in time_closure(s, edges, par) for (_, _, k) in edges.get(u, ())): continue
        sc = screen(s); b = buttons(s)
        if sc in (1, 5, 6, 7, 8, 9, 10) or b: continue  # 사람 할 일을 안내하는 행
        key = (s.mode, s.tag, s.ord, s.dst, s.cs, s.stage, s.rw, s.excl, s.runner is not None and s.rage == 0, (s.lead == s.runner) if s.runner else None, sc)
        out[key].append(s)
    print(f'\n## ③ 안내 없는 정지(산 워커 없음·시간이 흘러도 팀장 안 움직임·화면이 사람 할 일 안내 안 함): 묶음 {len(out)}, 상태 {sum(len(v) for v in out.values())}')
    for k, lst in sorted(out.items(), key=lambda x: -len(x[1]))[:40]:
        ex = min(lst, key=lambda s: len(path(par, s)))
        print(f'  {len(lst):5d} mode={k[0]} tag={int(k[1])} ord={k[2]} dst={k[3]} cs={k[4]} stage={k[5]} rw={int(k[6])} excl={k[7]} runner신선={k[8]} 팀장PC=runner={k[9]} 화면={SCREEN_TXT[k[10]]}')
        print('        예: ' + fmt(ex)); print('        경로: ' + ' → '.join(path(par, ex)))

def lead_takes_manual(par, edges):
    # 표식 없는(수동) 주문, 또는 사람이 손으로 claim 한 주문을 팀장이 이어받는 전이
    found = collections.defaultdict(list)
    for s in par:
        for (l, t, k) in edges[s]:
            if k == 'lead' and s.ord == 'claimed' and l.startswith(SPAWN):
                p = path(par, s)
                manual_claim = any(x.startswith('수동 /dflow-dev') for x in p)
                lead_claim = any(x.startswith(SPAWN + '팀장 spawn') for x in p)
                if not s.tag or (manual_claim and not lead_claim):
                    key = ('표식 없음' if not s.tag else '표식 있음·사람이 claim', s.dst, s.stage, l.split('(')[0])
                    found[key].append((s, p + [l]))
    print(f'\n## 팀장이 사람의 수동 주문(표식 없음 또는 사람이 claim)을 이어받는 전이: {len(found)} 종')
    for key, lst in sorted(found.items(), key=lambda x: -len(x[1]))[:12]:
        s, p = min(lst, key=lambda x: len(x[1]))
        print(f'  {len(lst):5d} {key}\n    경로: ' + ' → '.join(p))

def screen_probe(par, edges):
    print('\n## ③ 화면 문구가 사실과 다른 도달 상태')
    probes = collections.defaultdict(list)
    for s in par:
        sc = screen(s)
        live = s.wA is not None or s.wB is not None
        if sc == 3 and s.ord == 'ready' and not s.tag: probes['3행 「구현 대기」인데 표식 없음(팀장이 안 가져감)'].append(s)
        if sc == 3 and s.excl == 'perm' and s.wA is None and s.wB is None: probes['3행 「구현 대기」인데 팀장이 영구 제외'].append(s)
        if sc in (3, 4) and s.ord == 'claimed' and s.excl == 'perm' and not live: probes['3·4행 대기 문구인데 영구 제외'].append(s)
        if sc == 5 and live: probes['5행 「재작업 대기」인데 재작업 워커가 돌고 있음(WBS·허브)'].append(s)
        if sc == 7 and s.tag: probes['7행 「위임 안 됨」인데 표식 있음'].append(s)
        if sc == 0 and s.ord == 'ready' and s.dst == 'accepted': probes['ready·accepted 인데 행 없음(단계 어긋남, 되돌리기 버튼 없음)'].append(s)
        if sc == 0 and s.ord == 'claimed' and s.stage == 'ds' and action(s) == 'wait' and not live: probes['「설계 중」인데 아무도 설계하지 않음(선행 대기)'].append(s)
        if sc == 0 and s.ord == 'ready' and s.tag and s.pct == 100 and not ge_ip(s.stage): probes['표식·ready·실적 100·단계 ip 미만: 행 없음, 판단은 full/design'].append(s)
        if sc == 0 and s.ord == 'claimed' and ge_ip(s.stage) and s.dst == 'accepted' and not live and s.excl == 'perm': probes['「작업 중」인데 failed(영구 제외), 「이어서 시작」 숨김'].append(s)
    for k, lst in probes.items():
        ex = min(lst, key=lambda s: len(path(par, s)))
        print(f'  {k}: {len(lst)} 상태\n    예: {fmt(ex)}\n    경로: ' + ' → '.join(path(par, ex)))

def pct_check(par):
    print('\n## ⑥ 실적(기본 크레딧표): 앞으로 가는 사건의 역행은 전이 중 I6 로 잡는다. 단계보다 낮은 실적:')
    bad = collections.defaultdict(list)
    for s in par:
        exp = {'as': 0, 'ds': 10, 'dd': 20, 'ip': 30, 'im': 80, 'xx': 100}[s.stage]
        if s.pct < exp and not (s.stage == 'ip' and s.pct == 50): bad[('낮음', s.stage, s.pct)].append(s)
    for k, lst in bad.items():
        ex = min(lst, key=lambda s: len(path(par, s)))
        print(f'  {k}: {len(lst)} 상태 — 예: ' + ' → '.join(path(par, ex)))
    if not bad: print('  없음')

if __name__ == '__main__':
    par, edges = main()
    analyze(par, edges); loops(par, edges); silent(par, edges); lead_takes_manual(par, edges); screen_probe(par, edges); pct_check(par)
