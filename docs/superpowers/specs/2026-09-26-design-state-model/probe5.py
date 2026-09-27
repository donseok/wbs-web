# ⑤ 세분: 두 워커가 build-start 뒤인 상태 중, 둘 다 온라인(run)이고 서로 다른 PC 인 상태가 오래 지속되는지(즉시 멈춤 전이가 없는지)
import sys, collections
sys.argv = ['model5.py'] + sys.argv[1:]
exec(open('model5.py').read().split("if __name__ == '__main__':\n    par, edges = main()")[0])
par, edges = bfs()
both_online = []
for s in par:
    if s.ord == 'claimed' and s.wA and s.wB and s.wA[1] == 1 and s.wB[1] == 1 and s.wA[2] == 'run' and s.wB[2] == 'run':
        # 비-runner 워커를 멈추는 전이가 있나
        stops = [l for (l, t, k) in edges[s] if 'runner_active → 멈춤' in l]
        both_online.append((s, stops))
print('변형:', {k: v for k, v in V.items() if k.startswith('FIX') or k in ('RESUME_PAST_BS', 'SLIM', 'RELEASE_STOPS_WORKER')})
print('상태 수:', len(par), ' 두 워커 모두 온라인·build-start 뒤:', len(both_online), ' 그중 비-runner 멈춤 전이 없음:', sum(1 for _, st in both_online if not st))
ex = [s for s, st in both_online if not st]
if ex:
    e = min(ex, key=lambda s: len(path(par, s)))
    print('예:', fmt(e)); print('경로:', ' → '.join(path(par, e)))
# 보고자가 runner 가 아닌 완료 보고
rep = [(s, l) for s in par for (l, t, k) in edges[s] if '완료 보고' in l and s.ord == 'claimed' and s.runner is not None and ('@' + s.runner) not in l]
print('runner 가 아닌 워커의 완료 보고 전이:', len(rep))
if rep:
    s, l = min(rep, key=lambda x: len(path(par, x[0])))
    print('예:', l, '|', fmt(s)); print('경로:', ' → '.join(path(par, s)))
