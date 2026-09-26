# 설계 상태 스펙 4판 상태 공간 모델 — 스펙 행 번호는 docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md (52f17fad)
import itertools, collections, sys, json

V = dict(
    BUILD_IP_REQUIRES_ACCEPTED=False,  # 5.2 build 행(210): "ip 이상이면 같은 점유 사용자에게 멱등 통과" 에 accepted 가 붙나
    REWORK_SCOPE_FROM_CS=False,        # D21: 재작업 워커가 claim_scope 를 그대로 build-start 범위로 보내나(참) / rework 를 보내나(거짓)
    MODE_CHANGE_ALLOW_APPROVED=False,  # 7절 344: "주문이 없거나" 에 approved 가 드나
    CONFIRM_REQUIRES_TAG_SERVER=False, # 4.1 ② (118) 에 위임 표식 조건이 있나(7절 347 은 있다)
    OLD_KIT=False,                     # 옛 킷(legacy+design_first, 재작업 때 build-start 안 부름) 혼용
    GATE_RERUN_AT_IP=True,             # 6.4 297: build 로 재개한 워커가 ip 에서도 Design 게이트를 다시 도나
)
for a in ' '.join(sys.argv[1:]).split():
    k, v = a.split('=')
    V[k] = v == '1'

CRED = {'as': 0, 'ds': 10, 'dd': 20, 'ip': 30, 'rw': 50, 'im': 80, 'xx': 100}
GE_IP = {'ip', 'im', 'xx'}
F = collections.namedtuple('S', 'mode tag ord dst cs stage pct rw hb pc preds hd note w wstep excl res')
# ord: none ready claimed reported approved cancelled / dst: none review accepted / cs: None legacy full design build
# hb: none fresh blocked stale wait / pc: '-' same other / preds: met ok no (ok = 미충족이 모두 dd·ip) / hd: 개발 브랜치 사람 설계
# w: 살아 있는 워커 범위(None full design build rework legacy) / wstep: 0 build-start 전, 1 뒤 / excl: None temp perm stop
# res: None died result

def ge_ip(st): return st in GE_IP

# ---- 5.3 판단(225-239) ----
def action(s, f):
    if s.ord in ('none',): return 'none'
    if s.ord in ('reported', 'approved', 'cancelled'): return 'skip'                 # 1
    if s.ord == 'claimed' and (ge_ip(s.stage) or s.hb in ('fresh',)): return 'skip'   # 2 (wait phase 는 신선 아님, blocked 는 ACTIVE 아님)
    if s.ord == 'ready' and ge_ip(s.stage): return 'skip'                             # 3
    if s.dst == 'review': return 'wait'                                               # 4
    if s.dst == 'accepted' and s.preds != 'met': return 'wait'                        # 5
    if s.dst == 'accepted' and f != 'design_only': return 'build'                     # 6
    if s.dst == 'accepted': return 'skip'                                             # 7
    if s.ord == 'claimed':                                                            # 8
        if s.stage not in ('ds', 'dd'): return 'skip'
        c = s.cs or 'legacy'
        if c == 'design': return 'skip' if f == 'build_from' else 'design'
        if c in ('full', 'legacy'):
            if s.preds != 'met': return 'wait'
            return 'full' if f is None else 'skip'
        return 'skip'
    if s.mode == 'human': return 'skip'                                               # 9
    if s.preds == 'no': return 'wait'                                                 # 10
    if (s.mode == 'review' and f != 'build_from') or (s.mode == 'auto' and f == 'design_only'): return 'design'  # 11
    if s.mode == 'auto' and f is None: return 'full'                                  # 12
    return 'skip'                                                                     # 13

def mine(s):  # 5.3 끝(245-247), D25
    return s.ord == 'ready' or (s.ord == 'claimed' and s.pc == 'same')

# ---- 5.2 관문(192-219) ----
def can_claim(s, scope, df):
    if ge_ip(s.stage): return ('409', 'stage')                                        # 197
    if scope in ('full', 'legacy'):
        if not (s.mode == 'auto' and s.dst == 'none'): return ('409', 'design_gate')  # 201
    elif scope == 'design':
        if not (s.mode in ('auto', 'review') and s.dst == 'none'): return ('409', 'design_gate')  # 202
        if s.hd: return ('skip', 'human_draft')                                       # 6.3 286
        df = s.preds != 'met'
    elif scope == 'build':
        if s.dst != 'accepted': return ('409', 'design_not_accepted')                 # 203
        df = False
    # 선행 관문(claim 라우트 67-89, D15 dd·ip 확장)
    if s.preds != 'met':
        if not df: return ('403', 'dependency_not_met')
        if s.preds == 'no': return ('403', 'design_first_too_early')
    return None

def can_build_start(s, scope):
    c = s.cs or 'legacy'
    if scope == 'full':                                                               # 209
        ok = s.mode == 'auto' and s.dst == 'none' and c in ('full', 'legacy')
        if not (s.stage in ('ds', 'dd') or ge_ip(s.stage)) or not ok: return ('409', 'design_gate')
    elif scope == 'build':                                                            # 210
        if s.stage == 'dd':
            if s.dst != 'accepted': return ('409', 'design_not_accepted')
        elif ge_ip(s.stage):
            if V['BUILD_IP_REQUIRES_ACCEPTED'] and s.dst != 'accepted': return ('409', 'design_not_accepted')
        else: return ('409', 'design_gate')
    elif scope == 'rework':                                                           # 211
        if not (s.stage == 'ip' and s.ord == 'claimed' and s.dst != 'review'): return ('409', 'design_gate')
    elif scope == 'legacy':                                                           # 212
        if ge_ip(s.stage):
            if s.dst == 'review': return ('409', 'design_gate')
        else:
            return can_build_start(s, 'full')
    if not ge_ip(s.stage) and s.preds != 'met': return ('403', 'dependency_not_met')  # 215
    return None

def up(s, **kw): return s._replace(**kw)
def mx(p, key): return max(p, CRED[key])                                              # D19

# ---- 4.1 사건(113-127) ----
def ev_claim(s, scope, df):
    st = s.stage
    if scope in ('full', 'design'): st2, key = 'ds', 'ds'                             # 116
    elif scope == 'build': st2, key = 'dd', 'dd'
    else: st2, key = ('ds', 'ds') if df else ('ip', 'ip')
    return up(s, ord='claimed', cs=scope, stage=st2, pct=mx(s.pct, key), excl=None)

def ev_design_done(s):                                                                # 117
    if s.ord != 'claimed' or ge_ip(s.stage): return s
    dst = s.dst
    if dst == 'none' and (s.mode == 'review' or s.cs == 'design'): dst = 'review'
    return up(s, stage='dd', dst=dst, pct=mx(s.pct, 'dd'))

def ev_reopen(s):                                                                     # 119
    if s.ord not in ('claimed', 'ready'): return None
    if s.stage == 'ip' or s.mode in ('review', 'auto'):
        return up(s, dst='review' if s.dst == 'accepted' else s.dst, note=True)
    # human, ip 아님
    s2 = up(s, stage='as', dst='none', pct=0, note=True)
    if s.ord == 'claimed':
        s2 = up(s2, ord='ready', cs=None, hb='none', pc='-', w=None, wstep=0)
    return s2

def ev_cancel(s):                                                                     # 127, D14
    if s.ord == 'claimed':
        return up(s, ord='cancelled', dst='none', cs=None, stage='as', pct=0, w=None, wstep=0, hb='none', pc='-', rw=False, note=False)
    if s.ord == 'ready':
        st, p = (('as', 0) if s.stage == 'dd' else (s.stage, s.pct))
        return up(s, ord='cancelled', dst='none', cs=None, stage=st, pct=p, note=False)
    return s

def wscope_from_cs(s):                                                                # D21
    c = s.cs or 'legacy'
    return {'design': 'design', 'full': 'full', 'legacy': 'full', 'build': 'build'}[c]

VIOL = []  # (kind, state, label)

def transitions(s):
    out = []
    def add(lbl, t, tag=None):
        if t is not None and t != s: out.append((lbl, t))
    # ---------- 사람(웹) ----------
    if not s.tag:
        t = up(s, tag=True)
        if t.stage is None: t = up(t, stage='as', pct=0)
        if t.ord in ('none', 'cancelled') and not ge_ip(t.stage):                      # D26(approved 면 ord==approved 라 안 만든다)
            t = up(t, ord='ready', dst='none', cs=None, rw=False, note=False, hb='none', pc='-', excl=None, res=None, w=None, wstep=0)
        add('위임 켬', t)
    else:
        t = ev_cancel(up(s, tag=False)); add('위임 해제·중단', t)
    if not s.tag and s.ord not in ('claimed', 'reported'):
        for st in ('as', 'ds', 'ip', 'im', 'xx'):
            add(f'set_stage {st}', up(s, stage=st, pct=CRED[st]))
    okm = s.ord in ('none', 'ready', 'cancelled') or (V['MODE_CHANGE_ALLOW_APPROVED'] and s.ord == 'approved')
    if s.dst == 'none' and okm:
        for m in ('auto', 'review', 'human'):
            if m != s.mode: add(f'방식 {m}', up(s, mode=m))
    if s.dst == 'review' and s.ord == 'claimed':
        add('설계 승인①', up(s, dst='accepted', cs='build', note=False))
    if s.dst == 'none' and s.ord == 'ready' and s.mode == 'human' and s.stage == 'as' and (s.tag or not V['CONFIRM_REQUIRES_TAG_SERVER']):
        add('설계 확정②' + ('' if s.tag else '(표식 없음)'), up(s, stage='dd', dst='accepted', pct=mx(s.pct, 'dd'), note=False))
    if s.ord == 'reported':
        add('승인', up(s, ord='approved', stage='xx', pct=100))
        add('반려', up(s, ord='claimed', stage='ip', pct=CRED['rw'], rw=True, w=None, wstep=0, res='result'))
    if s.ord == 'approved':
        add('재작업', up(s, ord='claimed', stage='ip', pct=CRED['rw'], rw=True, w=None, wstep=0, res='result'))
        add('승인 취소', up(s, ord='reported', stage='im', pct=80))
    if s.ord == 'claimed' and s.dst == 'none' and s.cs != 'design':                   # D13
        add('release', up(s, ord='ready', stage='as', pct=0, cs=None, hb='none', pc='-', w=None, wstep=0, res=None))
    add('사람 설계 토글', up(s, hd=not s.hd))
    # 사람의 수동 /dflow-dev (다른 PC 도 가능)
    if s.w is None:
        for pc in ('same', 'other'):
            if s.ord == 'ready':
                for sc in ('full', 'design', 'build'):
                    r = can_claim(s, sc, s.preds != 'met')
                    if r is None:
                        add(f'수동 /dflow-dev --scope {sc}@{pc}', up(ev_claim(s, sc, s.preds != 'met'), w=sc, wstep=0, hb='fresh', pc=pc, res=None))
                if V['OLD_KIT']:
                    r = can_claim(s, 'legacy', True)
                    if r is None:
                        add(f'옛 킷 claim@{pc}', up(ev_claim(s, 'legacy', True), w='legacy', wstep=0, hb='fresh', pc=pc, res=None))
            elif s.ord == 'claimed':
                if s.rw and s.stage == 'ip':
                    ws = wscope_from_cs(s) if V['REWORK_SCOPE_FROM_CS'] else 'rework'
                else:
                    ws = wscope_from_cs(s)
                add(f'수동 재개 {ws}@{pc}', up(s, w=ws, wstep=0, hb='fresh', pc=pc, res=None))
    # ---------- 환경 ----------
    for p in ('met', 'ok', 'no'):
        if p != s.preds: add(f'선행 {p}', up(s, preds=p))
    if s.w is not None:
        add('워커 죽음', up(s, w=None, wstep=0, hb='stale', res='died'))
        if s.hb != 'blocked': add('워커 질문(blocked)', up(s, hb='blocked'))
    if s.excl == 'temp': add('일시 제외 풀림', up(s, excl=None))
    # ---------- 팀장(필터 셋 중 하나로 떠 있음, 이 PC=same) ----------
    if s.w is None and s.excl is None:
        for f in (None, 'design_only', 'build_from'):
            a = action(s, f)
            if a not in ('build', 'design', 'full') or not mine(s): continue
            fl = f'팀장[{f or "필터없음"}]'
            if s.ord == 'ready':
                if a == 'build' and s.mode == 'human' and not s.hd:                   # 6.2 273
                    add(fl + ' 띄우기 전 검사 → design-reopen', ev_reopen(s)); continue
                if a == 'design' and s.hd:                                            # 6.2 274
                    add(fl + ' 띄우기 전 검사 → 멈춤', up(s, excl='stop')); continue
                df = s.preds != 'met'
                r = can_claim(s, a, df)
                if r is not None:
                    VIOL.append(('I2 claim 거부', s, f'{fl} action={a} → {r}'))
                    add(fl + f' spawn {a} → claim 거부 {r}', up(s, excl='temp'))
                else:
                    add(fl + f' spawn {a}', up(ev_claim(s, a, df), w=a, wstep=0, hb='fresh', pc='same', res=None))
            else:
                ws = wscope_from_cs(s)
                if ws != a: VIOL.append(('I2 범위 불일치', s, f'{fl} action={a} claim_scope→{ws}'))
                add(fl + f' 재개 spawn({a}, 워커 {ws})', up(s, w=ws, wstep=0, hb='fresh', res=None))
    # 재시작(restart.md): action 을 보지 않는다. 결과 없이 죽은 이 PC 워커, wait phase 아님
    if s.ord == 'claimed' and s.w is None and s.res == 'died' and s.pc == 'same' and s.hb not in ('wait',) and s.excl != 'perm':
        ws = ('rework' if (s.rw and s.stage == 'ip' and not V['REWORK_SCOPE_FROM_CS']) else wscope_from_cs(s))
        add(f'팀장 재시작(워커 {ws})', up(s, w=ws, wstep=0, hb='fresh', res=None))
    # ---------- 워커 단계 ----------
    if s.w is not None and s.ord == 'claimed':
        w = s.w
        def blocked(t, code):  # 6.7: build-start exit 11 → blocked(영구 제외, SKILL.md:252)
            return up(t, w=None, wstep=0, hb='stale', excl='perm', res='result')
        if w == 'design' and s.stage == 'ds':
            add('워커 design-done(설계만 멈춤)', up(ev_design_done(s), w=None, hb='wait', res='result'))
        if w in ('full', 'build', 'legacy', 'rework') and s.wstep == 0 and s.stage in ('ds', 'dd', 'ip', 'im', 'xx'):
            if w == 'build' and s.stage == 'dd':
                if s.mode == 'human' and not s.hd:                                     # 6.4 301
                    add('워커 게이트 불통 → design-reopen', up(ev_reopen(s), w=None, res='result'))
                if s.mode != 'human':
                    add('워커 게이트 불통(사람이 고친 설계) → design-reopen', up(ev_reopen(s), w=None, hb='wait', res='result'))
            if w == 'build' and ge_ip(s.stage) and V['GATE_RERUN_AT_IP']:
                add('워커(ip 재개) 게이트 불통 → design-reopen', up(ev_reopen(s), w=None, hb='wait', res='result'))
            if w == 'legacy' and ge_ip(s.stage) and s.rw:
                # 옛 킷 재작업: build-start 없이 바로 구현 → 아래 wstep=1 로
                add('옛 킷 재작업 시작(관문 없음)', up(s, wstep=1))
            else:
                r = can_build_start(s, w)
                if r is None:
                    t = s
                    if s.stage in ('ds', 'dd'): t = up(s, stage='ip', pct=mx(s.pct, 'ip'))
                    if s.dst == 'review' or (s.mode in ('review', 'human') and s.dst != 'accepted'):
                        VIOL.append(('I1 build-start 통과(미승인 설계)', s, f'워커 {w}'))
                    add(f'워커 build-start {w} 통과', up(t, wstep=1))
                elif r[0] == '403':
                    add(f'워커 build-start 403 → wait_pred(design-done)', up(ev_design_done(s), w=None, hb='wait', res='result'))
                else:
                    add(f'워커 build-start {w} 거부 {r} → blocked', blocked(s, r))
        if s.wstep == 1 and s.stage == 'ip':
            if s.dst == 'review' or (s.mode in ('review', 'human') and s.dst != 'accepted'):
                VIOL.append(('I1 완료 보고 가능(미승인 설계)', s, f'워커 {w}'))
            if s.rw and s.dst == 'accepted' and w != 'legacy':
                add('워커 D24 설계 바뀜 → design-reopen', up(ev_reopen(s), w=None, wstep=0, res='result'))
            add('워커 완료 보고', up(s, ord='reported', stage='im', pct=mx(s.pct, 'im'), rw=False, w=None, wstep=0, hb='stale', res='result'))
    return out

# ---- 3절 판정표(94-105) ----
def screen(s):
    rows = []
    if s.stage in ('dd', 'ip') and s.dst == 'review': rows.append('A 설계 검토 대기' + ('(재작업)' if s.stage == 'ip' else ''))
    if s.stage == 'ip' and s.dst == 'accepted' and s.ord == 'claimed': rows.append('B 재작업 대기(설계 재승인됨)')
    if s.stage == 'dd' and s.dst == 'accepted': rows.append('C 구현 대기' if s.preds == 'met' else 'D 선행 대기(승인됨)')
    if s.stage == 'dd' and s.dst == 'none': rows.append('F 설계 완료·구현 대기' if s.preds == 'met' else 'E 설계 완료·선행 대기')
    if s.stage == 'as' and s.dst == 'none' and s.mode == 'human':
        rows.append('G 사람 설계 대기+확정' if (s.tag and s.ord == 'ready') else 'H 사람 설계 대기(위임 안 됨)')
    if s.stage == 'as' and s.dst == 'none' and s.mode == 'review' and s.preds != 'met': rows.append('I 선행 대기')
    if ge_ip(s.stage) and s.dst == 'none' and s.tag and s.ord in ('none', 'cancelled', 'approved', 'ready'):
        rows.append('J 위임 보류(단계가 이미 진행됨)')
    return rows

def buttons(s):
    b = []
    if s.dst == 'review' and s.ord == 'claimed': b.append('설계 승인')
    if s.mode == 'human' and s.tag and s.stage == 'as' and s.dst == 'none' and s.ord == 'ready': b.append('설계 확정')
    return b

def initial():
    for mode in ('auto', 'review', 'human'):
        for ordv in ('none', 'ready'):
            yield F(mode, False, ordv, 'none', None, 'as', 0, False, 'none', '-', 'met', False, False, None, 0, None, None)

def bfs():
    par = {}
    q = collections.deque()
    for s in initial():
        par[s] = (None, 'init')
        q.append(s)
    while q:
        s = q.popleft()
        for lbl, t in transitions(s):
            if t not in par:
                par[t] = (s, lbl)
                q.append(t)
    return par

def path(par, s):
    seq = []
    while s is not None:
        p, l = par[s]
        seq.append(l)
        s = p
    return list(reversed(seq))

if __name__ == '__main__':
    par = bfs()
    print('변형:', V)
    print('도달 상태 수:', len(par))
    seen = set()
    for k, s, l in VIOL:
        key = (k, l.split(' →')[0], s.mode, s.ord, s.dst, s.cs, s.stage)
        if key in seen: continue
        seen.add(key)
    # 가장 짧은 경로 하나씩
    best = {}
    for k, s, l in VIOL:
        kk = (k, l)
        p = path(par, s)
        if kk not in best or len(p) < len(best[kk][1]): best[kk] = (s, p)
    for (k, l), (s, p) in sorted(best.items(), key=lambda x: len(x[1][1])):
        print(f'\n[{k}] {l}\n  상태: mode={s.mode} tag={s.tag} ord={s.ord} dst={s.dst} cs={s.cs} stage={s.stage} pct={s.pct} rw={s.rw} hb={s.hb} pc={s.pc} preds={s.preds} hd={s.hd} w={s.w}\n  경로: ' + ' → '.join(p))

# ---- 막힘·안내 분석 ----
def analyze(par):
    states = list(par.keys())
    edges = {s: transitions(s) for s in states}
    rev_all = collections.defaultdict(set); rev_nc = collections.defaultdict(set); rev_g = collections.defaultdict(set)
    unguided = ('위임 해제·중단', '수동', 'release', 'set_stage', '옛 킷')
    for s, outs in edges.items():
        for lbl, t in outs:
            if t not in par: continue
            rev_all[t].add(s)
            if not lbl.startswith('위임 해제·중단'): rev_nc[t].add(s)
            if not any(lbl.startswith(u) for u in unguided): rev_g[t].add(s)
    goal = [s for s in states if s.ord == 'approved']
    def back(rev):
        seen = set(goal); q = collections.deque(goal)
        while q:
            t = q.popleft()
            for s in rev[t]:
                if s not in seen: seen.add(s); q.append(s)
        return seen
    R_all, R_nc, R_g = back(rev_all), back(rev_nc), back(rev_g)
    def key(s): return (s.mode, s.tag, s.ord, s.dst, s.cs, s.stage, s.rw, s.hb, s.pc, s.excl, s.w is not None)
    cat = collections.defaultdict(list)
    for s in states:
        if s not in R_all: cat['a 완료로 가는 길 없음'].append(s)
        elif s not in R_nc: cat['b 중단을 거쳐야만'].append(s)
        elif s not in R_g: cat['b2 버튼·자동만으로는 못 감(수동 실행·release·set_stage 필요)'].append(s)
    for k, lst in cat.items():
        print(f'\n## {k}: {len(lst)} 상태')
        groups = collections.Counter((s.mode, s.tag, s.ord, s.dst, s.cs, s.stage, s.hb, s.pc, s.excl, 'w' if s.w else '-') for s in lst)
        for g, n in groups.most_common(40):
            ex = next(s for s in lst if (s.mode, s.tag, s.ord, s.dst, s.cs, s.stage, s.hb, s.pc, s.excl, 'w' if s.w else '-') == g)
            print(f'  {n:4d} mode={g[0]} tag={g[1]} ord={g[2]} dst={g[3]} cs={g[4]} stage={g[5]} hb={g[6]} pc={g[7]} excl={g[8]} worker={g[9]} | 화면={screen(ex)} 버튼={buttons(ex)}')
            print('       예: ' + ' → '.join(path(par, ex)))
    return R_all, R_nc, R_g

def silent(par):
    # (c) 산 워커 없음, 어느 필터의 팀장도 띄우지 않음, 3절 행·버튼 없음, 위임 표식 있고 ready·claimed
    out = collections.defaultdict(list)
    for s in par:
        if s.w is not None or not s.tag or s.ord not in ('ready', 'claimed'): continue
        acts = {f: action(s, f) for f in (None, 'design_only', 'build_from')}
        spawnable = any(a in ('build', 'design', 'full') for a in acts.values()) and mine(s) and s.excl is None
        restartable = s.ord == 'claimed' and s.res == 'died' and s.pc == 'same' and s.hb != 'wait' and s.excl != 'perm'
        if spawnable or restartable: continue
        if screen(s) or buttons(s): continue
        k = (s.mode, s.ord, s.dst, s.cs, s.stage, s.preds, s.hb, s.pc, s.excl, s.hd, tuple(sorted(set(acts.values()))))
        out[k].append(s)
    print(f'\n## c 안내 없는 정지 상태(묶음 {len(out)})')
    for k, lst in sorted(out.items(), key=lambda x: -len(x[1]))[:60]:
        ex = min(lst, key=lambda s: len(path(par, s)))
        print(f'  mode={k[0]} ord={k[1]} dst={k[2]} cs={k[3]} stage={k[4]} preds={k[5]} hb={k[6]} pc={k[7]} excl={k[8]} hd={k[9]} actions={k[10]}')
        print('       예: ' + ' → '.join(path(par, ex)))

def screen_mislabel(par):
    print('\n## 3절 행이 정상 상태에 걸리는지')
    probes = collections.defaultdict(list)
    for s in par:
        r = screen(s)
        if s.ord == 'approved' and s.stage == 'xx' and s.tag and s.dst == 'none': probes['승인된 auto 작업(xx·approved·표식)'].append((s, r))
        if s.ord == 'claimed' and s.stage == 'ip' and s.dst == 'accepted' and not s.rw and s.w is not None: probes['review·human 첫 구현 중(claimed·ip·accepted, 반려 이력 없음, 워커 살아 있음)'].append((s, r))
        if s.ord == 'claimed' and s.stage == 'ip' and s.dst == 'accepted' and s.rw and s.w is None: probes['반려 직후(claimed·ip·accepted, 설계 재승인 없음)'].append((s, r))
        if s.ord == 'claimed' and s.stage == 'dd' and s.dst == 'accepted' and s.pc == 'other' and s.w is None: probes['승인됨·다른 PC 점유(dd·accepted·pc other)'].append((s, r))
        if s.ord == 'ready' and s.stage == 'dd' and s.dst == 'accepted' and not s.tag: probes['확정됐는데 표식 없음(ready·dd·accepted)'].append((s, r))
        if s.ord == 'claimed' and s.excl == 'perm' and s.dst == 'accepted' and s.stage == 'dd': probes['blocked 설계 관문 뒤 재승인(dd·accepted·영구 제외)'].append((s, r))
    for k, lst in probes.items():
        rows = collections.Counter(tuple(r) for _, r in lst)
        ex = min((s for s, _ in lst), key=lambda s: len(path(par, s)))
        print(f'  {k}: {len(lst)} 상태, 화면 행 {dict(rows)}')
        print('       예: ' + ' → '.join(path(par, ex)))

def pct_check(par):
    print('\n## 실적 이상(기본 크레딧표)')
    bad = collections.defaultdict(list)
    for s in par:
        exp = {'as': 0, 'ds': 10, 'dd': 20, 'ip': 30, 'im': 80, 'xx': 100}.get(s.stage)
        if exp is None: continue
        if s.pct < exp: bad[('낮음', s.stage, s.pct)].append(s)
        if s.stage == 'as' and s.pct != 0: bad[('as 인데 0 아님', s.stage, s.pct)].append(s)
    for k, lst in bad.items():
        ex = min(lst, key=lambda s: len(path(par, s)))
        print(f'  {k}: {len(lst)} 상태 — 예: ' + ' → '.join(path(par, ex)))
    if not bad: print('  없음')

if __name__ == '__main__' and 'ANALYZE' in ' '.join(sys.argv):
    pass
if __name__ == '__main__':
    par2 = bfs()
    analyze(par2); silent(par2); screen_mislabel(par2); pct_check(par2)
