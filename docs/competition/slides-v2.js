// ===========================================================================
// 발표 초안 v2 — 슬라이드 정의
//
// 장 순서는 심사 루브릭 순서를 따른다: 효과 → 확산 → 기술 → 지속. 기술 자랑을
// 앞세우지 않는다. 앞 3장은 전 직원 투표(30%)용 공감 훅이고, 4장부터가 심사(70%)용이다.
// 하나의 덱이 두 청중의 언어를 쓴다.
//
// 표준 양식이 나오면 이 파일의 각 장을 모듈처럼 그 양식에 옮긴다 — 그래서 장마다
// 독립적으로 완결되게 썼다.
// ===========================================================================
const SLIDES = [

// ── 1. 표지 ─────────────────────────────────────────────────────────────
{ title:'표지', dark:true, html:`
  <div class="body" style="justify-content:center;gap:34px">
    <div style="font-size:15px;letter-spacing:.2em;font-weight:800;color:#32b6ab">
      업무 속 AI 활용 경진대회 · 2026
    </div>
    <h1 style="font-size:64px;color:#f5efe7">
      회의가 끝나는 순간,<br><span style="color:#32b6ab">실행이 시작됩니다.</span>
    </h1>
    <div style="display:flex;align-items:center;gap:26px;font-size:22px;font-weight:700;color:#8b95a3">
      <span style="color:#f5efe7">또박또박</span><i style="width:1px;height:24px;background:#333d4a"></i>
      <span style="color:#f5efe7">D'Flow</span>
      <span style="font-size:17px;font-weight:600">— 회의록 AI와 프로젝트 실행 플랫폼</span>
    </div>
    <div style="margin-top:18px;padding-top:22px;border-top:1px solid #262d37;
                font-size:17px;color:#8b95a3;font-weight:600">
      MES운영팀 · 전사 PI TFT <span style="color:#4b5666">|</span>
      2026년, 두 조직이 실제로 쓰고 있는 도구입니다
    </div>
  </div>`},

// ── 2. 공감 훅 ──────────────────────────────────────────────────────────
{ title:'모두가 아는 장면', html:`
  <div class="eyebrow">모두가 아는 장면<s></s></div>
  <div class="body">
    <h2>이 폴더, 어느 팀에나 있습니다</h2>
    <div class="grid4" style="margin-top:8px">
      <div class="card" style="background:var(--before-bg);border-color:var(--line)">
        <div style="font-size:15px;font-weight:800;color:var(--before);margin-bottom:8px">일요일 밤</div>
        <div style="font-size:16px;line-height:1.5;color:#6f665e;font-weight:600">
          주간보고를 만들려고 여기저기서 숫자를 긁어모은다
        </div>
      </div>
      <div class="card" style="background:var(--before-bg);border-color:var(--line)">
        <div style="font-size:15px;font-weight:800;color:var(--before);margin-bottom:8px">회의 다음 날</div>
        <div style="font-size:16px;line-height:1.5;color:#6f665e;font-weight:600">
          "어제 뭐 하기로 했죠?" — 아무도 정확히 기억하지 못한다
        </div>
      </div>
      <div class="card" style="background:var(--before-bg);border-color:var(--line)">
        <div style="font-size:15px;font-weight:800;color:var(--before);margin-bottom:8px">수요일</div>
        <div style="font-size:16px;line-height:1.5;color:#6f665e;font-weight:600">
          <s>WBS_최종_최종2_진짜최종.xlsx</s> — 누구 버전이 맞는지 모른다
        </div>
      </div>
      <div class="card" style="background:var(--before-bg);border-color:var(--line)">
        <div style="font-size:15px;font-weight:800;color:var(--before);margin-bottom:8px">한 달 뒤</div>
        <div style="font-size:16px;line-height:1.5;color:#6f665e;font-weight:600">
          그때 그 결정사항을 찾으려는데, 찾을 방법이 없다
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:26px;border-color:#b9ded8;background:var(--brand-weak)">
      <div style="font-size:24px;font-weight:800;letter-spacing:-.02em;color:var(--ink)">
        문제는 기록이 없어서가 아니었습니다. <span style="color:var(--brand)">기록이 일로 이어지지 않아서였습니다.</span>
      </div>
    </div>
  </div>
  <div class="foot">이 네 장면을 없애는 것이 이번 사례의 전부입니다</div>`},

// ── 3. 무엇을 만들었나 ──────────────────────────────────────────────────
{ title:'무엇을 만들었나', html:`
  <div class="eyebrow">무엇을 만들었나<s></s></div>
  <div class="body">
    <h2>회의부터 실행까지, 끊긴 곳을 이었습니다</h2>
    <p class="lead">두 개의 도구지만 하나의 흐름입니다. 회의에서 나온 한 문장이 실행 계획까지 끊기지 않고 갑니다.</p>
    <div class="grid2" style="margin-top:14px">
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span class="pill act">01</span>
          <b style="font-size:22px;letter-spacing:-.02em">또박또박</b>
          <span style="font-size:14px;color:var(--subtle);font-weight:700">회의록 AI</span>
        </div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:9px;
                   font-size:16px;line-height:1.45;font-weight:600;color:var(--muted)">
          <li>· 말하면 그대로 받아쓰고, 화자를 자동으로 구분</li>
          <li>· 회의가 끝나면 핵심·결정·할 일이 이미 정리돼 있음</li>
          <li>· 요약 문장을 클릭하면 그 말을 한 지점으로 점프</li>
          <li>· 지난 회의 전체를 가로질러 질문 가능</li>
          <li>· 음성·기록이 <b style="color:var(--brand)">외부로 나가지 않음</b> (로컬 처리)</li>
        </ul>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span class="pill act">02</span>
          <b style="font-size:22px;letter-spacing:-.02em">D'Flow</b>
          <span style="font-size:14px;color:var(--subtle);font-weight:700">프로젝트 실행 플랫폼</span>
        </div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:9px;
                   font-size:16px;line-height:1.45;font-weight:600;color:var(--muted)">
          <li>· 엑셀 WBS를 온라인으로 — 버전이 하나로 수렴</li>
          <li>· 진척·지연·위험이 자동 계산되어 상시 최신</li>
          <li>· 회의록의 할 일이 담당·기한과 함께 계획에 반영</li>
          <li>· 주간보고를 <b style="color:var(--brand)">클릭 한 번</b>으로 공식 양식 PPT</li>
          <li>· 물어보면 답하는 봇 — 근거 데이터까지 함께</li>
        </ul>
      </div>
    </div>
  </div>
  <div class="foot">두 도구 모두 <b>2026년에 만들어 2026년에 쓰고 있는</b> 사례입니다</div>`},

// ── 4. 전/후 한눈에 ─────────────────────────────────────────────────────
{ title:'개선 전/후 — 한눈에', html:`
  <div class="eyebrow">개선 효과 <span class="rub">· 심사 배점 최대</span><s></s></div>
  <div class="body">
    <h2>도입 전 / 도입 후</h2>
    <div class="ba" style="margin-top:16px">
      <div class="side b">
        <h4><u></u>도입 전</h4>
        <ul>
          <li>회의는 받아적고, 정리는 며칠 뒤</li>
          <li>할 일은 사람 기억에 의존</li>
          <li>WBS는 엑셀 파일로 오가며 버전이 갈림</li>
          <li>진척은 취합하는 주 1회만 최신</li>
          <li>주간보고는 매주 손으로 다시</li>
          <li>지난 결정사항은 사실상 검색 불가</li>
        </ul>
      </div>
      <div class="arrow">→</div>
      <div class="side a">
        <h4><u></u>도입 후</h4>
        <ul>
          <li>회의가 끝나면 회의록이 이미 완성</li>
          <li>할 일이 담당·기한과 함께 계획에 등록</li>
          <li>WBS는 한 곳, 버전 개념이 사라짐</li>
          <li>진척은 입력하는 순간 최신</li>
          <li>주간보고는 클릭 한 번, 공식 양식 그대로</li>
          <li>물어보면 근거와 함께 답이 나옴</li>
        </ul>
      </div>
    </div>
  </div>
  <div class="foot">다음 두 장에서 <b>회의</b>와 <b>실행</b>을 각각 자세히 봅니다</div>`},

// ── 5. 회의 전/후 상세 ──────────────────────────────────────────────────
{ title:'개선 전/후 ① 회의', html:`
  <div class="eyebrow">개선 효과 ① 회의 <span class="rub">· 또박또박</span><s></s></div>
  <div class="body">
    <h2>말이 기록이 되기까지</h2>
    <div class="ba" style="margin-top:12px">
      <div class="side b">
        <h4><u></u>도입 전</h4>
        <ul>
          <li>한 사람이 받아적느라 회의에 집중하지 못함</li>
          <li>정리·공유까지 며칠, 그사이 기억이 흐려짐</li>
          <li>결정과 할 일이 문장 속에 섞여 구분되지 않음</li>
          <li>"그때 왜 그렇게 정했지?"의 근거가 남지 않음</li>
          <li>지난 회의는 파일로만 존재 — 찾을 수 없음</li>
        </ul>
      </div>
      <div class="arrow">→</div>
      <div class="side a">
        <h4><u></u>도입 후</h4>
        <ul>
          <li>전원이 회의에만 집중, 기록은 자동</li>
          <li>회의 종료 시점에 회의록이 이미 완성</li>
          <li>결정 / 할 일(담당·기한)이 구조로 분리되어 추출</li>
          <li>요약 문장 → <b>실제 발언 지점으로 점프</b>, 근거 확인</li>
          <li>여러 회의를 가로질러 질문 — 답변에 출처 표시</li>
        </ul>
      </div>
    </div>
    <div class="card" style="margin-top:16px;padding:16px 22px;display:flex;
                             align-items:center;gap:20px;border-color:#b9ded8">
      <span class="pill act">차별점</span>
      <div style="font-size:17px;font-weight:700;color:var(--muted)">
        음성·전사·요약이 <b style="color:var(--brand)">외부로 나가지 않습니다</b> —
        회의 내용을 다루는 도구에서 이 점이 도입 여부를 가릅니다
      </div>
    </div>
  </div>
  <div class="foot">화면 시연: 녹음 → 실시간 자막 → 화자 자동 구분 → 회의록 완성 → 근거 점프</div>`},

// ── 6. 실행 전/후 상세 ──────────────────────────────────────────────────
{ title:'개선 전/후 ② 실행', html:`
  <div class="eyebrow">개선 효과 ② 실행 <span class="rub">· D'Flow</span><s></s></div>
  <div class="body">
    <h2>기록이 일이 되기까지</h2>
    <div class="ba" style="margin-top:12px">
      <div class="side b">
        <h4><u></u>도입 전</h4>
        <ul>
          <li>WBS 엑셀이 메일·메신저로 오가며 버전이 갈림</li>
          <li>취합하는 사람이 매주 수작업으로 병합</li>
          <li>진척은 취합 시점에만 최신, 그 사이는 깜깜</li>
          <li>지연·위험은 누군가 눈으로 발견해야 알 수 있음</li>
          <li>주간보고 PPT를 매주 처음부터 다시 작성</li>
        </ul>
      </div>
      <div class="arrow">→</div>
      <div class="side a">
        <h4><u></u>도입 후</h4>
        <ul>
          <li>하나의 WBS — 버전 충돌이라는 개념이 사라짐</li>
          <li>각자 입력, 상위 진척은 가중치로 자동 계산</li>
          <li>입력하는 순간 전원이 같은 숫자를 봄</li>
          <li>지연·위험이 대시보드에 신호로 자동 표시</li>
          <li>주간보고 <b>클릭 한 번</b> → 공식 양식 PPT 생성</li>
        </ul>
      </div>
    </div>
    <div class="card" style="margin-top:16px;padding:16px 22px;display:flex;
                             align-items:center;gap:20px;border-color:#b9ded8">
      <span class="pill act">연결</span>
      <div style="font-size:17px;font-weight:700;color:var(--muted)">
        회의록에서 뽑힌 할 일이 <b style="color:var(--brand)">그대로 계획의 한 줄</b>이 됩니다 —
        두 도구를 잇는 지점이자, 이 사례의 핵심입니다
      </div>
    </div>
  </div>
  <div class="foot">화면 시연: 액션 반영 → WBS 진척 자동 계산 → 위험 신호 → 주간보고 PPT</div>`},

// ── 7. 대표 지표 ────────────────────────────────────────────────────────
{ title:'대표 지표 5선', html:`
  <div class="eyebrow">개선 효과 ③ 숫자<s></s></div>
  <div class="body">
    <h2>숫자로 보면</h2>
    <p class="lead">모든 수치에 출처를 함께 답니다. 추정은 추정이라고 씁니다.</p>
    <table style="margin-top:12px">
      <tr><th style="width:30%">지표</th><th style="width:16%">도입 전</th>
          <th style="width:16%">도입 후</th><th style="width:38%">출처</th></tr>
      <tr>
        <td><b>주간보고 1건 산출 시간</b></td>
        <td><s>__시간</s></td><td><span class="num">__분</span></td>
        <td><span class="pill est">추정</span> 팀 무기명 추정(n·중앙값·범위 공개) → 생성 로그로 대체 예정</td>
      </tr>
      <tr>
        <td><b>실적 데이터 최신 주기</b></td>
        <td><s>주 1회</s></td><td><span class="num">상시</span></td>
        <td><span class="pill act">실측</span> 변경 이력 — 주당 편집 __건 · 참여 __명</td>
      </tr>
      <tr>
        <td><b>회의 결정 → 계획 반영</b></td>
        <td><s>__일</s></td><td><span class="num">__분</span></td>
        <td><span class="pill act">실측</span> 도입 전·후 동일 기준으로 집계 (매칭 규칙 사전 문서화)</td>
      </tr>
      <tr>
        <td><b>지난 결정사항 찾는 시간</b></td>
        <td><s>__분</s></td><td><span class="num">__초</span></td>
        <td><span class="pill exp">실험</span> 기존 방식 vs AI 질의, 3인 × 3과제 비교</td>
      </tr>
      <tr>
        <td><b>구축·운영 비용</b></td>
        <td><s>외주 견적 __</s></td><td><span class="num">0원</span></td>
        <td><span class="pill act">실측</span> 라이선스·API 비용 0원 / 견적은 가정임을 병기</td>
      </tr>
    </table>
  </div>
  <div class="foot">빈칸은 <b>8/31 제출 전까지</b> 순서대로 채웁니다 — 채우는 방법은 다음 장</div>`},

// ── 8. 측정 방법 공개 ───────────────────────────────────────────────────
{ title:'측정 방법', html:`
  <div class="eyebrow">개선 효과 ④ 측정 방법<s></s></div>
  <div class="body">
    <h2>이 숫자를 어떻게 얻었는지 공개합니다</h2>
    <p class="lead">전/후 비교에서 가장 약한 고리는 언제나 '도입 전' 숫자입니다. 그래서 방법론을 먼저 밝힙니다.</p>
    <div class="grid3" style="margin-top:14px">
      <div class="card">
        <span class="pill est">1층 · 추정</span>
        <div style="font-size:19px;font-weight:800;margin:12px 0 8px">도입 전 기준선</div>
        <div style="font-size:15px;line-height:1.55;color:var(--muted);font-weight:600">
          팀원이 무기명으로 추정하고 근거를 한 줄씩 답니다.
          단일 숫자가 아니라 <b>중앙값·범위·응답자 수</b>를 함께 공개합니다.
        </div>
      </div>
      <div class="card">
        <span class="pill act">2층 · 실측(소급)</span>
        <div style="font-size:19px;font-weight:800;margin:12px 0 8px">이미 쌓인 기록</div>
        <div style="font-size:15px;line-height:1.55;color:var(--muted);font-weight:600">
          변경 이력·회의록·보고서 작성 기록은 시스템에 이미 남아 있습니다.
          <b>두 조직에서 각각</b> 산출해 표본을 두 배로 만듭니다.
        </div>
      </div>
      <div class="card">
        <span class="pill act">3층 · 실측 대 실측</span>
        <div style="font-size:19px;font-weight:800;margin:12px 0 8px">가장 강한 근거</div>
        <div style="font-size:15px;line-height:1.55;color:var(--muted);font-weight:600">
          새 기능은 <b>적용 전 구간의 실측</b>이 이미 쌓여 있어,
          추정 없이 실측끼리 비교할 수 있습니다.
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:18px;padding:16px 22px;background:var(--brand-weak);border-color:#b9ded8">
      <div style="font-size:18px;font-weight:700;color:var(--ink)">
        측정 방법을 공개하는 것 자체가 이 사례의 주장입니다 —
        <b style="color:var(--brand)">검증할 수 없는 개선은 개선이 아닙니다.</b>
      </div>
    </div>
  </div>
  <div class="foot">Q&amp;A 대비: "그 숫자 어디서 나왔나요?" → 이 장 한 장으로 답합니다</div>`},

// ── 9. 확산 — 두 현장 ───────────────────────────────────────────────────
{ title:'확산 ① 두 현장', html:`
  <div class="eyebrow">확산 가능성 <span class="rub">· 이미 두 조직</span><s></s></div>
  <div class="body">
    <h2>"쓸 수 있을까"가 아니라 "이미 쓰고 있습니다"</h2>
    <p class="lead">성격이 다른 두 조직이 같은 도구로 일합니다. 확산 가능성은 계획이 아니라 이미 일어난 일입니다.</p>
    <div class="grid2" style="margin-top:16px">
      <div class="card">
        <span class="pill act">현장 1</span>
        <div style="font-size:23px;font-weight:800;margin:12px 0 10px;letter-spacing:-.02em">MES운영팀</div>
        <div style="font-size:16px;line-height:1.55;color:var(--muted);font-weight:600">
          단일 팀의 실제 프로젝트 운영에 적용.
          <b>팀 업무 적용</b>이라는 대회 요건을 그대로 충족합니다.
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line);
                    font-size:15px;color:var(--subtle);font-weight:700">
          적용 범위: 계획·진척·주간보고·회의록 전 과정
        </div>
      </div>
      <div class="card">
        <span class="pill act">현장 2</span>
        <div style="font-size:23px;font-weight:800;margin:12px 0 10px;letter-spacing:-.02em">전사 PI TFT</div>
        <div style="font-size:16px;line-height:1.55;color:var(--muted);font-weight:600">
          여러 부서가 섞인 횡단 조직에서도 동작.
          <b>우리 팀 사람이 아닌 사람들</b>이 쓰고 있다는 것이 확산의 증거입니다.
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line);
                    font-size:15px;color:var(--subtle);font-weight:700">
          적용 범위: 부서 횡단 과제 관리·회의 운영
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:18px;padding:16px 22px;border-color:#b9ded8">
      <div style="font-size:18px;font-weight:700;color:var(--muted)">
        만든 것은 소수지만, <b style="color:var(--brand)">쓰는 사람은 두 조직 전원</b>입니다.
      </div>
    </div>
  </div>
  <div class="foot">발표 시 두 조직 구성원이 각자 자기 현장의 전/후를 증언합니다</div>`},

// ── 10. 확산 — 이관 로드맵 ──────────────────────────────────────────────
{ title:'확산 ② 이관 로드맵', html:`
  <div class="eyebrow">확산 가능성 <span class="rub">· 다음 단계</span><s></s></div>
  <div class="body">
    <h2>다음 팀이 시작하는 데 필요한 것</h2>
    <p class="lead">새 팀이 쓰기 시작하는 데 필요한 절차는 <b>프로젝트 개설 → 구성원 초대</b>, 두 단계입니다.</p>
    <div class="grid3" style="margin-top:16px">
      <div class="card">
        <div style="font-size:13px;font-weight:800;letter-spacing:.1em;color:var(--brand)">STEP 1</div>
        <div style="font-size:20px;font-weight:800;margin:10px 0 8px">희망 부서 파일럿</div>
        <div style="font-size:15px;line-height:1.5;color:var(--muted);font-weight:600">
          주간보고 자동화만 먼저 적용해 보는 최소 단위 도입. 기존 업무 방식을 바꾸지 않아도 됩니다.
        </div>
      </div>
      <div class="card">
        <div style="font-size:13px;font-weight:800;letter-spacing:.1em;color:var(--brand)">STEP 2</div>
        <div style="font-size:20px;font-weight:800;margin:10px 0 8px">사내 인프라 이관</div>
        <div style="font-size:15px;line-height:1.5;color:var(--muted);font-weight:600">
          표준 기술로만 만들어 특정 서비스에 묶여 있지 않습니다. 사내 환경으로 옮기는 데 재개발이 필요 없습니다.
        </div>
      </div>
      <div class="card">
        <div style="font-size:13px;font-weight:800;letter-spacing:.1em;color:var(--brand)">STEP 3</div>
        <div style="font-size:20px;font-weight:800;margin:10px 0 8px">전사 표준화</div>
        <div style="font-size:15px;line-height:1.5;color:var(--muted);font-weight:600">
          부서별로 다른 보고 양식을 그대로 수용하면서, 데이터는 한 곳에 모입니다.
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:18px;padding:16px 22px;background:var(--brand-weak);border-color:#b9ded8">
      <div style="font-size:17px;font-weight:700;color:var(--ink)">
        <b style="color:var(--brand)">IT 서비스 회사이기 때문에</b> 가능한 확산입니다 —
        도입이 곧 우리 회사의 역량 증명이 됩니다.
      </div>
    </div>
  </div>
  <div class="foot">파일럿 희망 부서를 이 자리에서 받습니다</div>`},

// ── 11. 기술·창의 ───────────────────────────────────────────────────────
{ title:'기술·창의 ① AI 페어링', html:`
  <div class="eyebrow">창의성·기술 <span class="rub">· 어떻게 만들었나</span><s></s></div>
  <div class="body">
    <h2>AI와 함께 만들고, AI가 안에서 일합니다</h2>
    <div class="grid2" style="margin-top:14px">
      <div class="card">
        <span class="pill act">만드는 AI</span>
        <div style="font-size:21px;font-weight:800;margin:12px 0 10px">설계부터 검증까지 페어링</div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:10px;
                   font-size:16px;line-height:1.45;color:var(--muted);font-weight:600">
          <li>· 기능마다 설계 문서를 먼저 쓰고 구현 — 문서 수십 건이 남아 있음</li>
          <li>· 자동 테스트로 매 변경을 검증</li>
          <li>· 짧은 기간에 플랫폼 규모에 도달 — <b>커밋 이력이 시점을 증명</b></li>
        </ul>
      </div>
      <div class="card">
        <span class="pill act">일하는 AI</span>
        <div style="font-size:21px;font-weight:800;margin:12px 0 10px">대답을 넘어 실행까지</div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:10px;
                   font-size:16px;line-height:1.45;color:var(--muted);font-weight:600">
          <li>· 회의록에서 할 일을 뽑아 <b>계획에 반영</b></li>
          <li>· 사람이 확인·승인한 뒤에만 데이터가 바뀜</li>
          <li>· 숫자는 AI가 아니라 계산 로직이 냄 — <b>지어내지 않음</b></li>
        </ul>
      </div>
    </div>
    <div class="card" style="margin-top:18px;padding:18px 24px;border-color:#b9ded8">
      <div style="font-size:20px;font-weight:800;color:var(--ink);letter-spacing:-.02em">
        대답하는 AI는 이미 많습니다. 이 사례의 AI는
        <span style="color:var(--brand)">일을 합니다.</span>
      </div>
    </div>
  </div>
  <div class="foot">라이브 시연 1개: 회의록의 할 일 → 확인 → 계획에 반영되는 순간</div>`},

// ── 12. 기술·창의 ② 비용 ────────────────────────────────────────────────
{ title:'기술·창의 ② 비용 0원', html:`
  <div class="eyebrow">창의성·기술 <span class="rub">· 비용 구조</span><s></s></div>
  <div class="body">
    <h2>구축비 0원 · 운영비 0원 · 라이선스 0원</h2>
    <p class="lead">유료 API를 쓰지 않습니다. 무료 AI만으로 운영하되, 끊겼을 때를 설계에 넣었습니다.</p>
    <div class="grid3" style="margin-top:16px">
      <div class="card">
        <div style="font-size:19px;font-weight:800;margin-bottom:10px">1차 · 무료 AI</div>
        <div style="font-size:15px;line-height:1.5;color:var(--muted);font-weight:600">
          평상시 경로. 사용량 한도에 걸리면 자동으로 다음 단으로 넘어갑니다.
        </div>
      </div>
      <div class="card">
        <div style="font-size:19px;font-weight:800;margin-bottom:10px">2차 · 대체 모델</div>
        <div style="font-size:15px;line-height:1.5;color:var(--muted);font-weight:600">
          한 곳이 막혀도 다른 경로로 계속 동작합니다. 관리 화면에서 <b>재배포 없이 전환</b>됩니다.
        </div>
      </div>
      <div class="card">
        <div style="font-size:19px;font-weight:800;margin-bottom:10px">3차 · AI 없이도</div>
        <div style="font-size:15px;line-height:1.5;color:var(--muted);font-weight:600">
          AI가 전부 멈춰도 진척·일정·보고서 같은 <b>핵심 기능은 그대로 동작</b>합니다.
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:18px;padding:16px 22px;background:var(--brand-weak);border-color:#b9ded8">
      <div style="font-size:17px;font-weight:700;color:var(--ink)">
        AI를 <b style="color:var(--brand)">있으면 좋은 것</b>으로 설계했습니다 —
        없으면 멈추는 시스템은 업무에 쓸 수 없기 때문입니다.
      </div>
    </div>
  </div>
  <div class="foot">유료 전환·서비스 중단 리스크에 대한 답변이 이 장에 들어 있습니다</div>`},

// ── 13. 지속가능성 ──────────────────────────────────────────────────────
{ title:'지속가능성', html:`
  <div class="eyebrow">지속 운영 <span class="rub">· 만든 사람이 없어도</span><s></s></div>
  <div class="body">
    <h2>내일도, 내년에도 돌아가게</h2>
    <div class="grid3" style="margin-top:14px">
      <div class="card">
        <div style="font-size:20px;font-weight:800;margin-bottom:10px">문서가 기억을 대신합니다</div>
        <div style="font-size:15px;line-height:1.55;color:var(--muted);font-weight:600">
          기능마다 <b>왜 그렇게 만들었는지</b>가 설계 문서로 남아 있습니다.
          담당자가 바뀌어도 판단의 근거가 사라지지 않습니다.
        </div>
      </div>
      <div class="card">
        <div style="font-size:20px;font-weight:800;margin-bottom:10px">권한이 한 사람에 묶이지 않습니다</div>
        <div style="font-size:15px;line-height:1.55;color:var(--muted);font-weight:600">
          부관리자를 지정해 운영 권한을 나눕니다.
          계정·권한은 화면에서 관리되며 시스템 지식이 필요 없습니다.
        </div>
      </div>
      <div class="card">
        <div style="font-size:20px;font-weight:800;margin-bottom:10px">고장을 전제로 만들었습니다</div>
        <div style="font-size:15px;line-height:1.55;color:var(--muted);font-weight:600">
          AI 장애·응답 실패·데이터 누락 각각에 대해
          <b>무엇으로 대체할지</b>가 이미 코드에 들어 있습니다.
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:18px;padding:16px 22px;border-color:var(--line2)">
      <div style="font-size:17px;font-weight:700;color:var(--muted)">
        지속가능성은 의지가 아니라 구조의 문제입니다 —
        <b style="color:var(--brand)">문서·권한·폴백</b> 세 가지로 답합니다.
      </div>
    </div>
  </div>
  <div class="foot">Q&amp;A 대비: "만든 사람이 이동하면?" → 이 장으로 답합니다</div>`},

// ── 14. 데이터 관리 (선제 공개) ─────────────────────────────────────────
{ title:'데이터 관리', html:`
  <div class="eyebrow">지속 운영 <span class="rub">· 먼저 밝힙니다</span><s></s></div>
  <div class="body">
    <h2>데이터는 이렇게 다루고 있습니다</h2>
    <p class="lead">업무 데이터를 다루는 도구인 만큼, 묻기 전에 먼저 밝히는 것이 맞다고 판단했습니다.</p>
    <div class="grid2" style="margin-top:14px">
      <div class="card">
        <div style="font-size:19px;font-weight:800;margin-bottom:12px">지금 적용된 조치</div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:10px;
                   font-size:16px;line-height:1.45;color:var(--muted);font-weight:600">
          <li>· 회의 음성·전사·요약은 <b>외부로 전송되지 않음</b></li>
          <li>· 로그인한 사람이 볼 수 있는 범위를 데이터 계층에서 강제</li>
          <li>· 접근 권한은 프로젝트 단위로 분리</li>
          <li>· 발표·제출 자료의 모든 화면은 <b>시연용 데이터</b>만 사용</li>
        </ul>
      </div>
      <div class="card">
        <div style="font-size:19px;font-weight:800;margin-bottom:12px">다음 단계 (이관 계획)</div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:10px;
                   font-size:16px;line-height:1.45;color:var(--muted);font-weight:600">
          <li>· 데이터 보관 위치·범위 명세를 문서로 제출</li>
          <li>· 관련 부서와 협의해 사내 환경 이관 절차 확정</li>
          <li>· 표준 기술만 사용해 이관 시 재개발 불필요</li>
          <li>· 이관 전까지는 <b>파일럿 범위로 한정</b> 운영</li>
        </ul>
      </div>
    </div>
    <div class="card" style="margin-top:18px;padding:16px 22px;background:var(--brand-weak);border-color:#b9ded8">
      <div style="font-size:17px;font-weight:700;color:var(--ink)">
        빠르게 만들어 검증했고, <b style="color:var(--brand)">이제 제자리로 옮길 준비가 됐습니다.</b>
      </div>
    </div>
  </div>
  <div class="foot">이 장은 <b>질문받기 전에</b> 발표에서 먼저 꺼냅니다</div>`},

// ── 15. 마무리 ──────────────────────────────────────────────────────────
{ title:'마무리', dark:true, html:`
  <div class="body" style="justify-content:center;gap:36px">
    <h1 style="font-size:58px;color:#f5efe7">
      저희는 만들어 쓰던 것을<br>
      <span style="color:#32b6ab">대회에 내는 것입니다.</span>
    </h1>
    <div style="font-size:20px;line-height:1.7;color:#a8b2c0;font-weight:600;max-width:900px">
      대회를 위해 만든 것이 아니라, 매주 쓰던 것을 정리해 가져왔습니다.<br>
      회의에서 나온 한 문장이 실행까지 끊기지 않고 가는 것 —
      그게 저희가 바꾼 전부이고, 다른 팀에도 그대로 옮겨집니다.
    </div>
    <div style="margin-top:14px;padding-top:26px;border-top:1px solid #262d37;
                display:flex;align-items:center;gap:26px;font-size:26px;font-weight:800;color:#f5efe7">
      회의가 끝나는 순간, <span style="color:#32b6ab">실행이 시작됩니다.</span>
    </div>
  </div>`},

// ── 16. 부록 · 예상 질문 ────────────────────────────────────────────────
{ title:'부록 · 예상 질문', html:`
  <div class="eyebrow">부록 <span class="rub">· 준비된 답변</span><s></s></div>
  <div class="body">
    <h2>어떤 질문이든, 준비돼 있습니다</h2>
    <div class="grid2" style="margin-top:12px;gap:14px">
      <div class="card" style="padding:16px 20px">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">전/후 숫자의 근거는?</div>
        <div style="font-size:14px;line-height:1.5;color:var(--muted);font-weight:600">
          도입 전은 팀 무기명 추정(중앙값·범위·n 공개), 도입 후는 시스템 실측. 라벨로 구분 표기 — 측정 방법 장 참조
        </div>
      </div>
      <div class="card" style="padding:16px 20px">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">만든 사람이 이동하면?</div>
        <div style="font-size:14px;line-height:1.5;color:var(--muted);font-weight:600">
          설계 문서가 판단 근거를 보존하고, 부관리자로 권한을 분산. 운영에 시스템 지식이 필요 없음
        </div>
      </div>
      <div class="card" style="padding:16px 20px">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">무료 AI가 중단되면?</div>
        <div style="font-size:14px;line-height:1.5;color:var(--muted);font-weight:600">
          대체 경로로 자동 전환, 관리 화면에서 재배포 없이 교체. AI가 전부 멈춰도 핵심 기능은 동작
        </div>
      </div>
      <div class="card" style="padding:16px 20px">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">기성 도구 대신 자체 구축한 이유는?</div>
        <div style="font-size:14px;line-height:1.5;color:var(--muted);font-weight:600">
          우리 회사 보고 양식·업무 흐름에 맞춤. 라이선스 비용 0원이며, IT 서비스 회사로서 역량 증명이기도 함
        </div>
      </div>
      <div class="card" style="padding:16px 20px">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">AI 산출물이 틀리면?</div>
        <div style="font-size:14px;line-height:1.5;color:var(--muted);font-weight:600">
          사람이 확인·승인해야 데이터가 바뀜. 숫자는 AI가 아니라 계산 로직이 산출
        </div>
      </div>
      <div class="card" style="padding:16px 20px">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px">'AI 활용'이 아니라 '개발' 아닌가?</div>
        <div style="font-size:14px;line-height:1.5;color:var(--muted);font-weight:600">
          만든 과정도 AI 페어링이고, 안에서 매일 일하는 것도 AI. 둘 다 2026년 업무 적용 사례
        </div>
      </div>
    </div>
  </div>
  <div class="foot">모의 Q&amp;A 2회로 답변을 통일합니다 — 누가 답해도 같은 내용이 나오도록</div>`},

// ── 17. 부록 · 일정 ─────────────────────────────────────────────────────
{ title:'부록 · 대회 일정', html:`
  <div class="eyebrow">부록 <span class="rub">· 우리 팀 준비 일정</span><s></s></div>
  <div class="body">
    <h2>남은 일정</h2>
    <table style="margin-top:14px">
      <tr><th style="width:16%">시점</th><th style="width:30%">대회 일정</th><th>우리가 할 일</th></tr>
      <tr>
        <td><b>~7/27</b></td><td>—</td>
        <td>도입 전 기준선 추정 워크숍 · 사용량 계측 시작 · 사무국 문의(양식·마감·팀 구성)</td>
      </tr>
      <tr>
        <td><b>8월 중</b></td><td>—</td>
        <td>시연 영상 촬영 · 실측 수치 집계 · 데이터 관리 협의 · 발표 분담 확정</td>
      </tr>
      <tr>
        <td><b>8/31</b></td><td><b class="num">사례 제출 마감</b></td>
        <td>표준 양식에 내용 이식 · 영상 2종 제출 · 실명 노출 2인 교차 검수</td>
      </tr>
      <tr>
        <td><b>9/7~9/11</b></td><td><b class="num">전 직원 사전 투표</b> (30%)</td>
        <td>제출물만 보고 판단하는 구간 — 앞 3장과 영상이 전부</td>
      </tr>
      <tr>
        <td><b>9/14~9/18</b></td><td><b class="num">발표 및 심사</b> (70%)</td>
        <td>3인 분담 발표 · 녹화 본편 + 라이브 1신 · 모의 Q&amp;A 2회 완료</td>
      </tr>
      <tr>
        <td><b>10/1</b></td><td>최종 시상</td><td>—</td>
      </tr>
    </table>
    <div class="card" style="margin-top:16px;padding:14px 20px;border-color:var(--line2)">
      <div style="font-size:15px;font-weight:700;color:var(--muted)">
        <b style="color:var(--brand)">투표가 발표보다 먼저입니다.</b>
        전 직원은 발표를 보지 못하고 8/31 제출물만 보고 투표합니다 — 제출물의 완성도가 30%를 결정합니다.
      </div>
    </div>
  </div>
  <div class="foot">공고 기준 · 세부 사항은 사무국 공지로 확인 후 갱신</div>`},

];
render();
