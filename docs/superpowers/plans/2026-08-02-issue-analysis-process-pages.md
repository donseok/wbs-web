# 이슈 분석서 PPT 프로세스 체계 페이지(5·6·7) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 분석서 PPT에 As-Is 프로세스 트리(소스 슬라이드 5)와 프로세스 정의(소스 슬라이드 6) 페이지를 AI 초안으로 자동 포함한다.

**Architecture:** 정의 문장은 기존 Mega별 개선기회 LLM 호출을 v3로 확장해 같은 실행에 저장(호출 수 불변)하고, 스냅샷·저장 실행에 Major 마스터를 additive로 담는다. 덱 플랜이 저장본에서 트리/정의 슬라이드를 결정적으로 배치하고, 렌더러는 템플릿 5·6번 슬라이드의 지오메트리를 재사용(프로토타입 복제·잉여 삭제)한다. 구버전 저장 실행은 프로세스 페이지 없이 기존 그대로 렌더된다.

**Tech Stack:** Next.js 15 서버 액션 + JSZip XML 조작(기존 경로) + vitest. **마이그레이션 없음.**

**스펙:** `docs/superpowers/specs/2026-08-02-issue-analysis-process-pages-design.md`

## Global Constraints

- `git add -A` 금지 — 항상 파일명을 명시해 stage (병렬 세션 리포).
- 커밋 메시지 한국어, "왜" 중심. 각 커밋 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 마이그레이션 없음 → G1 무관. UI 위험 파일(`src/app/globals.css`, `src/components/app/*` 등) 안 건드림 → main 직행 가능.
- **push는 Task 9에서 1회만.** Task 6(덱 플랜)과 Task 7(렌더러) 사이 상태는 새 실행의 PPT 다운로드가 명시적 에러가 되므로 중간 배포 금지.
- 로컬 `npm run build`는 `_workspace` 스크래치 때문에 실패한다(리포 메모리, Vercel 무관) — 검증은 `npm run lint` + `npx vitest run <파일>` + 전체 `npm run test`.
- 상수 정본: 트리 열 8, 열당 Sub 6, 정의 행 4/페이지, Mega 정의 ≤200자, Major 정의 ≤150자, 미지정 라벨 `(미지정)`, 프롬프트 버전 `issue-causes-opportunities-defs-v3`.
- 스펙 대비 확정 편차 1건: **process-definition 슬라이드에도 `headline`을 넣는다** (셈플 6·7페이지가 5페이지 요약문을 그대로 반복). Task 6에서 스펙 문서에도 반영한다.

## 파일 구조 맵

| 파일 | 역할 |
|---|---|
| `src/lib/report/issues/slideXml.ts` (신규) | 슬라이드 XML 프리미티브 공용 계층 (jszipRenderer에서 추출 + 신규 헬퍼 2개) |
| `src/lib/report/issues/jszipRenderer.ts` (수정) | 패키지 조립·기존 슬라이드 렌더 + 신규 kind 스위치/검증 |
| `src/lib/report/issues/processSlideRenderer.ts` (신규) | 트리/정의 슬라이드 렌더러 |
| `src/lib/report/issues/processPages.ts` (신규) | 트리 열·정의 행·슬라이드 시리즈 순수 빌더 + 새 슬라이드 타입 |
| `src/lib/report/issues/deckPlan.ts` (수정) | 슬라이드 union 확장 + 영역 루프에 프로세스 슬라이드 삽입 |
| `src/lib/report/issues/model.ts` (수정) | Major/정의 타입·상수·스냅샷/보고서 빌더 확장 (additive) |
| `src/lib/report/issues/storedRun.ts` (수정) | 저장 JSON 파서 하위호환 확장 |
| `src/lib/ai/issue-analysis.ts` (수정) | 프롬프트 v3 + 정의 검증/파스 + ensure 배선 |
| `src/lib/data/issueAnalysis.ts` (수정) | 로더가 `{ issues, majors }` 반환 |
| `src/app/actions/issueAnalysis.ts` (수정) | 로더/ensure 배선 |
| `src/components/issues/IssueAnalysisModal.tsx` (수정) | Major 미지정 안내 1줄 |
| `src/lib/i18n/dict/issues.ts` (수정) | 안내 키 ko/en |

템플릿 실측 정본(`src/lib/report/assets/issue-analysis-template.pptx`, px = EMU/9525):

- 슬라이드 5 — 제목 `146`, 헤드라인 `145`, 우상단 태그 `100`, 푸터 `5`(쪽번호)/`6`(작성자).
  Mega 체브론(x순, Mega 00~07): `128, 125, 135, 126, 134, 127, 129, 130` (active=135, inactive 프로토타입=128).
  Major 박스(x순, 열 1~8): `116, 102, 111, 51, 70, 77, 103, 92` (y≈287, w≈98px, 열 pitch≈111px).
  Sub 박스 24개: `53,54,71,72,78,79,80,86,87,93,94,107,108,109,110,113,118,119,120,121,123,136,137,139`
  (프로토타입=`108`(2열 첫 칸, y≈383), 행 pitch = `107`.y−`108`.y ≈50px, w≈102 h≈41).
  커넥터 15개: `55,60,63,66,69,73,76,83,91,101,105,106,114,115,117` (세로 스파인 프로토타입=`101`, w=0).
- 슬라이드 6 — 제목 `146`, 헤드라인 `145`, 태그 `100`, 푸터 `5`/`6`, Mega 박스 `52`, Mega 정의 `49`,
  Major 이름 박스(y순) `48, 56, 58, 60`, 정의 박스(y순) `50, 57, 59, 61`, 행 커넥터(y순) `65, 66, 67, 68`.
- 정의 페이지는 슬라이드 6만 소스로 쓴다(7은 같은 레이아웃의 셈플 변형 — 미사용).

---

### Task 1: slideXml.ts 추출 + 신규 헬퍼 2개

**Files:**
- Create: `src/lib/report/issues/slideXml.ts`
- Modify: `src/lib/report/issues/jszipRenderer.ts`
- Test: `tests/report/slide-xml.test.ts` (신규), 기존 `tests/report/issue-analysis-export.test.ts` 회귀

**Interfaces:**
- Produces (모두 `slideXml.ts`에서 export — 이동 함수는 본문 무변경):
  정규식 `SHAPE_RE, GROUP_SHAPE_RE, CONNECTOR_RE, GRAPHIC_FRAME_RE, TABLE_ROW_RE, TABLE_CELL_RE, PARAGRAPH_RE, PPR_RE, RPR_RE, END_RPR_RE`,
  함수 `escapeXml, textNode, shapeIdPattern, mapSingleXmlElement, mapShape, mapGraphicFrame, deleteShapeOrConnector, singleElementById, deleteGroupShape, withElementId, withGraphicFrameTransform, withElementTransform, withConnectorTargets, appendShapeTreeElements, toEndRunProperties, toRunProperties, withNormalAutofit, rebuildTextBody, setShapeElementText, setShapeText, setShapeElementInset, setPageFooter`,
  타입 `ElementTransform, TextBodyMode`,
  **신규** `readElementTransform(elementXml): {x,y,cx,cy}`, `withoutConnectorTargets(connectorXml): string`
- 내부 전용(비export 이동): `escapeRegExp, ParagraphKind, BULLET_PROPERTIES_RE, insertParagraphBulletChoice, withoutBullet, withIssueParagraphLevel, withBullet, withBold, withoutBold, rebuildParagraph`

- [ ] **Step 1: 신규 헬퍼의 실패 테스트 작성** — `tests/report/slide-xml.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  readElementTransform,
  withElementTransform,
  withoutConnectorTargets,
} from '@/lib/report/issues/slideXml'

const SHAPE = [
  '<p:sp><p:nvSpPr><p:cNvPr id="108" name="사각형 1"/></p:nvSpPr>',
  '<p:spPr><a:xfrm><a:off x="2221139" y="3650411"/><a:ext cx="971550" cy="390144"/></a:xfrm></p:spPr>',
  '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>견적관리</a:t></a:r></a:p></p:txBody></p:sp>',
].join('')

const CONNECTOR = [
  '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="101" name="직선 연결선 5"/>',
  '<p:cNvCxnSpPr><a:stCxn id="102" idx="2"/><a:endCxn id="120" idx="0"/></p:cNvCxnSpPr></p:nvCxnSpPr>',
  '<p:spPr><a:xfrm><a:off x="2721005" y="3100573"/><a:ext cx="0" cy="2461491"/></a:xfrm></p:spPr></p:cxnSp>',
].join('')

describe('readElementTransform', () => {
  it('shape의 EMU 좌표를 그대로 읽는다', () => {
    expect(readElementTransform(SHAPE)).toEqual({
      x: 2_221_139, y: 3_650_411, cx: 971_550, cy: 390_144,
    })
  })
  it('좌표 구조가 없으면 throw한다', () => {
    expect(() => readElementTransform('<p:sp></p:sp>')).toThrow('좌표')
  })
  it('withElementTransform 왕복이 일치한다', () => {
    const moved = withElementTransform(SHAPE, { x: 10, y: 20, cx: 30, cy: 40 })
    expect(readElementTransform(moved)).toEqual({ x: 10, y: 20, cx: 30, cy: 40 })
  })
})

describe('withoutConnectorTargets', () => {
  it('삭제된 도형을 가리키는 stCxn/endCxn 참조를 제거한다', () => {
    const detached = withoutConnectorTargets(CONNECTOR)
    expect(detached).not.toContain('stCxn')
    expect(detached).not.toContain('endCxn')
    expect(detached).toContain('cNvCxnSpPr')
    expect(readElementTransform(detached).cy).toBe(2_461_491)
  })
  it('참조가 없는 커넥터는 그대로 둔다', () => {
    const plain = CONNECTOR.replace(/<a:stCxn[^>]*\/>|<a:endCxn[^>]*\/>/g, '')
    expect(withoutConnectorTargets(plain)).toBe(plain)
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/slide-xml.test.ts` / Expected: FAIL (`slideXml` 모듈 없음)

- [ ] **Step 3: 추출 수행** — `jszipRenderer.ts`의 다음 블록을 `slideXml.ts`로 **본문 그대로** 이동하고 위 Interfaces 목록대로 `export`를 붙인다: 22~33행 정규식 전부, 34~533행의 `escapeXml`~`setShapeElementInset`, 698~708행 `setPageFooter`. `rebuildTextBody`가 쓰는 `IssueAnalysisDeckBodyParagraph` 타입 import는 `./deckPlan`에서 가져온다. 신규 헬퍼 2개를 추가한다:

```ts
/** 프로토타입 복제 시 원본 슬롯 좌표를 읽기 위한 xfrm 파서. */
export function readElementTransform(
  elementXml: string,
): { x: number; y: number; cx: number; cy: number } {
  const source = elementXml.match(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/)?.[0]
  const off = source?.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/)
  const ext = source?.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/)
  if (!off || !ext) {
    throw new Error('[issue-analysis] shape 좌표 구조를 읽을 수 없습니다.')
  }
  return {
    x: Number(off[1]),
    y: Number(off[2]),
    cx: Number(ext[1]),
    cy: Number(ext[2]),
  }
}

/**
 * 복제 커넥터의 원본 도형 참조를 끊는다. 참조 대상이 삭제된 채 남으면
 * PowerPoint가 임의 재접속하거나 복구 대화를 띄울 수 있다.
 */
export function withoutConnectorTargets(connectorXml: string): string {
  return connectorXml
    .replace(/<a:stCxn\b[^>]*\/>/, '')
    .replace(/<a:endCxn\b[^>]*\/>/, '')
}
```

`jszipRenderer.ts` 상단에 import를 추가하고 이동분을 삭제한다:

```ts
import {
  CONNECTOR_RE,
  GRAPHIC_FRAME_RE,
  PARAGRAPH_RE,
  PPR_RE,
  END_RPR_RE,
  SHAPE_RE,
  TABLE_CELL_RE,
  TABLE_ROW_RE,
  appendShapeTreeElements,
  deleteGroupShape,
  deleteShapeOrConnector,
  escapeXml,
  mapGraphicFrame,
  mapShape,
  mapSingleXmlElement,
  rebuildTextBody,
  setPageFooter,
  setShapeElementInset,
  setShapeElementText,
  setShapeText,
  shapeIdPattern,
  singleElementById,
  textNode,
  toEndRunProperties,
  withConnectorTargets,
  withElementId,
  withElementTransform,
  withGraphicFrameTransform,
  withNormalAutofit,
} from './slideXml'
```

(남은 미사용 import는 lint가 알려주는 대로 정리한다. `GROUP_SHAPE_RE`·`RPR_RE`는 이동 후 jszipRenderer에서 직접 쓰지 않으면 import하지 않는다.)

- [ ] **Step 4: 통과 + 회귀 확인** — Run: `npx vitest run tests/report/slide-xml.test.ts tests/report/issue-analysis-export.test.ts tests/report/issue-analysis-deck-plan.test.ts` / Expected: PASS (렌더 결과 무변경)

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/issues/slideXml.ts src/lib/report/issues/jszipRenderer.ts tests/report/slide-xml.test.ts
git commit -m "refactor(issues-ppt): 슬라이드 XML 프리미티브를 slideXml로 분리

프로세스 체계 페이지 렌더러(신설 예정)가 순환 참조 없이 재사용할 공용
계층을 확보한다. 이동 함수는 본문 무변경, readElementTransform·
withoutConnectorTargets 두 헬퍼만 신규.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: model.ts — Major 기준정보·정의 계약 (additive)

**Files:**
- Modify: `src/lib/report/issues/model.ts`
- Test: `tests/report/issue-analysis.test.ts` (케이스 추가)

**Interfaces:**
- Produces:
  - `ISSUE_ANALYSIS_MEGA_DEFINITION_MAX = 200`, `ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX = 150`
  - `interface IssueAnalysisMajorProcess { id: string; megaCode: IssueMegaCode; majorSeq: number; name: string }` (로더→스냅샷 입력)
  - `interface IssueAnalysisAreaMajor { id: string; majorSeq: number; name: string }` (영역 내부 표현)
  - `interface IssueAnalysisAreaProcessDefinitions { megaDefinition: string; majors: Array<{ majorId: string; definition: string }> }`
  - `IssueAnalysisReportIssue.majorId: string | null` (필드 추가)
  - `IssueAnalysisReportArea.majors?: IssueAnalysisAreaMajor[]`, `IssueAnalysisReportArea.processDefinitions?: IssueAnalysisAreaProcessDefinitions` (optional — 구버전 하위호환)
  - `buildIssueAnalysisInputSnapshot(projectId, issues, majors: readonly IssueAnalysisMajorProcess[] = [])`
  - `buildIssueAnalysisReport(snapshot, opportunities, generatedAt, causeAnalyses = {}, processDefinitions: Partial<Record<IssueMegaCode, IssueAnalysisAreaProcessDefinitions>> = {})`
- 스냅샷 area 타입의 Omit 목록에 `'processDefinitions'` 추가:
  `areas: Omit<IssueAnalysisReportArea, 'causeAnalyses' | 'opportunities' | 'processDefinitions'>[]`
  (→ `majors`는 스냅샷에 **포함**된다.)

- [ ] **Step 1: 실패 테스트 추가** — `tests/report/issue-analysis.test.ts`에 append (기존 픽스처 헬퍼 재사용, 없으면 파일 내 기존 이슈 생성 패턴을 복사):

```ts
const MAJOR_A = {
  id: '31000000-0000-4000-8000-000000000001',
  megaCode: '02' as const,
  majorSeq: 1,
  name: '주문관리',
}
const MAJOR_B = {
  id: '31000000-0000-4000-8000-000000000002',
  megaCode: '02' as const,
  majorSeq: 2,
  name: '수출관리',
}
const MAJOR_OTHER_MEGA = {
  id: '31000000-0000-4000-8000-000000000003',
  megaCode: '00' as const,
  majorSeq: 1,
  name: '품목기준정보',
}

describe('스냅샷 Major 기준정보', () => {
  it('영역별로 Mega가 일치하는 Major만 seq 순으로 담고 이슈 majorId를 보존한다', () => {
    // 이 파일의 기존 이슈 입력 생성 헬퍼로 mega '02' 이슈 1건을 만들고
    // majorId: MAJOR_A.id 를 지정한다.
    const snapshot = buildIssueAnalysisInputSnapshot(
      'project-1',
      [issueInput],
      [MAJOR_B, MAJOR_A, MAJOR_OTHER_MEGA],
    )
    const area = snapshot.areas.find(area => area.megaCode === '02')!
    expect(area.majors).toEqual([
      { id: MAJOR_A.id, majorSeq: 1, name: '주문관리' },
      { id: MAJOR_B.id, majorSeq: 2, name: '수출관리' },
    ])
    expect(area.issues[0].majorId).toBe(MAJOR_A.id)
    expect(snapshot.areas.find(area => area.megaCode === '00')!.majors)
      .toEqual([{ id: MAJOR_OTHER_MEGA.id, majorSeq: 1, name: '품목기준정보' }])
  })

  it('이슈가 기준정보에 없는 Major를 참조하면 throw한다', () => {
    expect(() => buildIssueAnalysisInputSnapshot('project-1', [issueInput], []))
      .toThrow('기준정보에 없습니다')
  })

  it('majors 생략(구 시그니처)은 빈 기준정보로 동작한다', () => {
    // majorId가 null인 이슈로 호출 — 기존 호출부 하위호환
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [legacyIssueInput])
    expect(snapshot.areas.every(area => area.majors.length === 0)).toBe(true)
  })
})

describe('보고서 processDefinitions', () => {
  it('전달된 Mega에만 정의를 붙이고 나머지는 키 자체가 없다', () => {
    const report = buildIssueAnalysisReport(snapshot, opportunities, generatedAt, {}, {
      '02': {
        megaDefinition: '고객 주문 이행 전반을 관리하는 프로세스임',
        majors: [
          { majorId: MAJOR_A.id, definition: '주문 접수부터 납기까지 관리하는 프로세스' },
          { majorId: MAJOR_B.id, definition: '수출 이행 전반을 관리하는 프로세스' },
        ],
      },
    })
    const area = report.areas.find(area => area.megaCode === '02')!
    expect(area.processDefinitions?.megaDefinition).toContain('주문 이행')
    expect(Object.prototype.hasOwnProperty.call(
      report.areas.find(area => area.megaCode === '00')!,
      'processDefinitions',
    )).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/issue-analysis.test.ts` / Expected: FAIL (majors 인자·필드 없음)

- [ ] **Step 3: 구현** — `model.ts`에:

```ts
export const ISSUE_ANALYSIS_MEGA_DEFINITION_MAX = 200
export const ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX = 150

/** 로더가 전달하는 프로젝트 전체 Major 기준정보(0062). */
export interface IssueAnalysisMajorProcess {
  id: string
  megaCode: IssueMegaCode
  majorSeq: number
  name: string
}

export interface IssueAnalysisAreaMajor {
  id: string
  majorSeq: number
  name: string
}

export interface IssueAnalysisAreaProcessDefinitions {
  megaDefinition: string
  majors: Array<{ majorId: string; definition: string }>
}
```

`IssueAnalysisReportIssue`에 `majorId: string | null` 추가. `IssueAnalysisReportArea`에:

```ts
  /** v2 저장 실행에는 이 두 필드가 없다. 신규 실행은 항상 함께 저장한다. */
  majors?: IssueAnalysisAreaMajor[]
  processDefinitions?: IssueAnalysisAreaProcessDefinitions
```

`toIssueAnalysisReportIssue` 반환 객체에 `majorId: issue.majorId ?? null,` 추가 (`IssueAnalysisIssueInput`의 베이스 `Issue`가 이미 `majorId?: string | null` 보유).

`buildIssueAnalysisInputSnapshot`:

```ts
export function buildIssueAnalysisInputSnapshot(
  projectId: string,
  issues: readonly IssueAnalysisIssueInput[],
  majors: readonly IssueAnalysisMajorProcess[] = [],
): IssueAnalysisInputSnapshot {
  const areas = ISSUE_MEGA_AREAS.map(area => {
    const areaIssues = issues
      .filter(issue => issue.megaCode === area.code)
      .sort(compareIssues)
      .map(toIssueAnalysisReportIssue)
    const areaMajors = majors
      .filter(major => major.megaCode === area.code)
      .sort((a, b) => a.majorSeq - b.majorSeq)
      .map(major => ({ id: major.id, majorSeq: major.majorSeq, name: major.name }))
    // FK가 보장하는 정합이 로드 경계에서 깨졌다면 잘못된 공식 산출물을 만들지 않는다.
    const areaMajorIds = new Set(areaMajors.map(major => major.id))
    for (const issue of areaIssues) {
      if (issue.majorId !== null && !areaMajorIds.has(issue.majorId)) {
        throw new Error(
          `[issue-analysis] ${issue.piIssueCode} 이슈의 Major가 기준정보에 없습니다: ${issue.majorId}`,
        )
      }
    }
    return {
      megaCode: area.code,
      megaName: area.nameKo,
      megaNameEn: area.nameEn,
      majors: areaMajors,
      summary: buildAreaSummary(areaIssues),
      issues: areaIssues,
    }
  })
  // (unclassifiedIssues 이하 기존 그대로)
```

`buildIssueAnalysisReport` 마지막 인자 추가 + area 스프레드에 conditional 부착 (causeAnalyses와 같은 패턴):

```ts
export function buildIssueAnalysisReport(
  snapshot: IssueAnalysisInputSnapshot,
  opportunities: Partial<Record<IssueMegaCode, IssueAnalysisOpportunity[]>>,
  generatedAt: string,
  causeAnalyses: Partial<Record<IssueMegaCode, IssueAnalysisIssueCauseAnalysis[]>> = {},
  processDefinitions: Partial<
    Record<IssueMegaCode, IssueAnalysisAreaProcessDefinitions>
  > = {},
): IssueAnalysisReport {
  // areas.map 내부, opportunities 스프레드 위에:
      const areaProcessDefinitions = processDefinitions[area.megaCode]
      ...
        ...(areaProcessDefinitions === undefined
          ? {}
          : {
              processDefinitions: {
                megaDefinition: areaProcessDefinitions.megaDefinition,
                majors: areaProcessDefinitions.majors.map(major => ({ ...major })),
              },
            }),
```

`IssueAnalysisInputSnapshot.areas`의 Omit 목록에 `'processDefinitions'` 추가.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/report/issue-analysis.test.ts` / Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/issues/model.ts tests/report/issue-analysis.test.ts
git commit -m "feat(issues-ppt): 분석 스냅샷·보고서에 Major 기준정보와 프로세스 정의 계약 추가

PPT 트리/정의 페이지의 데이터 정본을 저장 실행 안에 확보한다. 스키마는
issue-analysis.v1 유지 + optional additive(causeAnalyses 관례)라 구버전
저장본과 기존 호출부(기본 인자)가 그대로 동작한다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: storedRun 파서 하위호환 확장

**Files:**
- Modify: `src/lib/report/issues/storedRun.ts`
- Test: `tests/report/issue-analysis-stored-run.test.ts`

**Interfaces:**
- Consumes: Task 2의 `IssueAnalysisAreaMajor`, `IssueAnalysisAreaProcessDefinitions`, `ISSUE_ANALYSIS_MEGA_DEFINITION_MAX`, `ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX`
- Produces: `parseStoredIssueAnalysisReport`가 majors/majorId/processDefinitions를 검증·보존. 규칙:
  - 구버전 area(두 키 없음) → 그대로 통과, 필드 미부착.
  - `majorId` 키가 있으면 string(비공백) 또는 null만 허용.
  - `majors` 있으면: id 비공백·중복 금지, majorSeq 양의 정수 **오름차순 강증가**, name 비공백 ≤100자.
  - 이슈 `majorId`가 non-null인데 area `majors`가 없거나 목록에 없으면 → 전체 거부.
  - `processDefinitions` 있는데 `majors` 없으면 → 거부. 있으면 megaDefinition 비공백 ≤200·제어문자 금지, majors 배열이 area majors와 **정확히 1:1**(길이·id 집합), definition 비공백 ≤150·제어문자 금지. 출력 순서는 area majors 순으로 정규화.

- [ ] **Step 1: 실패 테스트 추가** — `tests/report/issue-analysis-stored-run.test.ts`의 기존 유효 JSON 픽스처 빌더(파일 상단에 있는 valid report 생성부)를 활용해 케이스 추가:

```ts
const STORED_MAJOR_A = { id: 'aaaa0000-0000-4000-8000-000000000001', majorSeq: 1, name: '주문관리' }
const STORED_MAJOR_B = { id: 'aaaa0000-0000-4000-8000-000000000002', majorSeq: 2, name: '수출관리' }
const STORED_DEFS = {
  megaDefinition: '고객 주문 이행 전반을 관리하는 프로세스임',
  majors: [
    { majorId: STORED_MAJOR_A.id, definition: '주문 접수부터 납기까지 관리하는 프로세스' },
    { majorId: STORED_MAJOR_B.id, definition: '수출 이행 전반을 관리하는 프로세스' },
  ],
}

describe('Major/정의 하위호환 파싱', () => {
  it('구버전(두 키 없음) 저장본은 그대로 통과한다', () => { /* 기존 유효 픽스처 그대로 → parse 성공 + area에 majors/processDefinitions 키 없음 */ })
  it('신버전 저장본은 majors·majorId·processDefinitions를 보존한다', () => {
    // 유효 픽스처의 '02' area에 majors: [A,B], issues[0].majorId = A.id,
    // processDefinitions: STORED_DEFS 를 넣고 parse → 동일 값 반환 확인
  })
  it('majorId가 majors 목록에 없으면 거부한다', () => { /* majors: [B]만 두고 issues[0].majorId = A.id → null */ })
  it('majors 없이 processDefinitions만 있으면 거부한다', () => { /* → null */ })
  it('정의가 Major와 1:1이 아니면 거부한다', () => { /* defs.majors에서 B 제거 → null */ })
  it('majorSeq가 강증가가 아니면 거부한다', () => { /* majors: [B(seq2), A(seq1)] 순서 → null */ })
  it('정의 길이 상한을 넘으면 거부한다', () => { /* definition 151자 → null */ })
})
```

(각 케이스는 이 파일의 기존 스타일대로 `JSON.parse(JSON.stringify(validReport))` 복제 후 변형 → `parseStoredIssueAnalysisReport(mutated, projectId)` 결과 단언으로 작성한다. 기존 유효 픽스처는 majors 없는 구버전이므로 첫 케이스가 그대로 회귀 검증이 된다.)

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/issue-analysis-stored-run.test.ts` / Expected: 신버전 보존 케이스 FAIL (파서가 필드를 버리거나 거부)

- [ ] **Step 3: 구현** — `storedRun.ts`에 파서 2개 추가 + 조립부 수정:

```ts
import {
  ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX,
  ISSUE_ANALYSIS_MEGA_DEFINITION_MAX,
  type IssueAnalysisAreaMajor,
  type IssueAnalysisAreaProcessDefinitions,
} from './model'

function parseAreaMajors(value: unknown): IssueAnalysisAreaMajor[] | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<string>()
  const majors: IssueAnalysisAreaMajor[] = []
  let lastSeq = 0
  for (const raw of value) {
    const object = record(raw)
    const id = object && nonEmpty(object.id)
    const majorSeq = object ? positiveInteger(object.majorSeq) : null
    const name = object && nonEmpty(object.name)
    if (
      !object || !id || majorSeq === null || !name
      || name.length > 100
      || ids.has(id)
      || majorSeq <= lastSeq
    ) return null
    ids.add(id)
    lastSeq = majorSeq
    majors.push({ id, majorSeq, name })
  }
  return majors
}

function parseProcessDefinitions(
  value: unknown,
  majors: readonly IssueAnalysisAreaMajor[],
): IssueAnalysisAreaProcessDefinitions | null {
  const object = record(value)
  const megaDefinition = object && nonEmpty(object.megaDefinition)
  if (
    !object || !megaDefinition
    || megaDefinition.length > ISSUE_ANALYSIS_MEGA_DEFINITION_MAX
    || UNSAFE_ANALYSIS_CONTROL_RE.test(megaDefinition)
    || !Array.isArray(object.majors)
    || object.majors.length !== majors.length
  ) return null
  const byId = new Map<string, string>()
  for (const raw of object.majors) {
    const item = record(raw)
    const majorId = item && nonEmpty(item.majorId)
    const definition = item && nonEmpty(item.definition)
    if (
      !item || !majorId || !definition
      || definition.length > ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX
      || UNSAFE_ANALYSIS_CONTROL_RE.test(definition)
      || byId.has(majorId)
    ) return null
    byId.set(majorId, definition)
  }
  if (majors.some(major => !byId.has(major.id))) return null
  return {
    megaDefinition,
    majors: majors.map(major => ({
      majorId: major.id,
      definition: byId.get(major.id) as string,
    })),
  }
}
```

`parseIssue`에 majorId 파싱 추가(반환 객체에 `majorId` 포함):

```ts
  let majorId: string | null = null
  if (Object.prototype.hasOwnProperty.call(object, 'majorId') && object.majorId !== null) {
    const parsedMajorId = nonEmpty(object.majorId)
    if (!parsedMajorId) return null
    majorId = parsedMajorId
  }
```

`parseStoredIssueAnalysisReport`의 area 루프에서 summary 파싱 앞뒤에:

```ts
    const hasMajors = Object.prototype.hasOwnProperty.call(areaObject, 'majors')
    const majors = hasMajors ? parseAreaMajors(areaObject.majors) : undefined
    if (hasMajors && majors === null) return null
    const majorIds = new Set((majors ?? []).map(major => major.id))
    if (typedIssues.some(issue =>
      issue.majorId !== null && !majorIds.has(issue.majorId))) return null

    const hasProcessDefinitions = Object.prototype.hasOwnProperty.call(
      areaObject,
      'processDefinitions',
    )
    if (hasProcessDefinitions && majors === undefined) return null
    const processDefinitions = hasProcessDefinitions
      ? parseProcessDefinitions(areaObject.processDefinitions, majors ?? [])
      : undefined
    if (hasProcessDefinitions && processDefinitions === null) return null
```

`areas.push({...})`에 conditional 스프레드 2개 추가:

```ts
      ...(majors === undefined ? {} : { majors }),
      ...(processDefinitions === undefined || processDefinitions === null
        ? {}
        : { processDefinitions }),
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/report/issue-analysis-stored-run.test.ts` / Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/issues/storedRun.ts tests/report/issue-analysis-stored-run.test.ts
git commit -m "feat(issues-ppt): 저장 실행 파서에 Major·프로세스 정의 하위호환 검증 추가

다운로드 경계는 브라우저를 신뢰하지 않고 저장 JSON을 재검증한다 — 신규
필드도 같은 원칙으로 통제하되, 필드가 없는 v2 저장본은 지금처럼 통과시켜
기존 실행의 PPT 다운로드를 깨지 않는다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: AI 순수 계층 v3 — 프롬프트·검증·파스

**Files:**
- Modify: `src/lib/ai/issue-analysis.ts`
- Test: `tests/ai/issue-analysis.test.ts`

**Interfaces:**
- Consumes: Task 2 타입/상수.
- Produces:
  - `ISSUE_ANALYSIS_PROMPT_VERSION = 'issue-causes-opportunities-defs-v3'`
  - `interface IssueAnalysisPromptMajor { majorId: string; seqLabel: string; name: string; subProcesses: string[]; issueCount: number }`
  - `buildIssueAnalysisMegaPrompt(megaCode, megaName, issues, majors?: readonly IssueAnalysisPromptMajor[])` — majors는 id/제목과 같은 "절대 비절삭" 급으로 minimum envelope에 포함. cause 경로는 기존처럼 majors 없이 호출(변경 없음).
  - `validateIssueAnalysisProcessDefinitions(value: unknown, majors: readonly Pick<IssueAnalysisAreaMajor, 'id'>[]): ProcessDefinitionsValidationResult`
  - `interface IssueAnalysisAreaGeneration { opportunities: IssueAnalysisOpportunity[]; processDefinitions: IssueAnalysisAreaProcessDefinitions }`
  - `parseIssueAnalysisAreaGeneration(raw, issues, majors): { ok: true; value: IssueAnalysisAreaGeneration } | { ok: false; error: string }`
  - 기존 `parseIssueAnalysisAreaResponse`(opportunities 전용)와 `parseIssueAnalysisResponse`는 시그니처 유지(Task 5에서 ensure가 신규 함수로 갈아탄 뒤에도 테스트 호환용으로 남긴다).

- [ ] **Step 1: 실패 테스트 추가** — `tests/ai/issue-analysis.test.ts`에 append:

```ts
const PROMPT_MAJORS = [
  {
    majorId: 'aaaa0000-0000-4000-8000-000000000001',
    seqLabel: '02.01',
    name: '주문관리',
    subProcesses: ['주문접수/등록'],
    issueCount: 1,
  },
  {
    majorId: 'aaaa0000-0000-4000-8000-000000000002',
    seqLabel: '02.02',
    name: '수출관리',
    subProcesses: [],
    issueCount: 0,
  },
]
const VALID_DEFS = {
  megaDefinition: '고객 주문 이행 전반을 관리하는 프로세스임',
  majors: [
    { majorId: PROMPT_MAJORS[0].majorId, definition: '주문 접수부터 납기까지 관리하는 프로세스' },
    { majorId: PROMPT_MAJORS[1].majorId, definition: '수출 이행 전반을 관리하는 프로세스' },
  ],
}

describe('프로세스 정의 검증', () => {
  const majors = PROMPT_MAJORS.map(major => ({ id: major.majorId }))
  it('정상 정의를 입력 majors 순서로 정규화해 통과시킨다', () => {
    const reversed = { ...VALID_DEFS, majors: [...VALID_DEFS.majors].reverse() }
    const result = validateIssueAnalysisProcessDefinitions(reversed, majors)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.majors.map(major => major.majorId))
        .toEqual(majors.map(major => major.id))
    }
  })
  it('입력에 없는 majorId 조작을 거부한다', () => {
    const forged = {
      ...VALID_DEFS,
      majors: [VALID_DEFS.majors[0], { majorId: 'ffff0000-0000-4000-8000-000000000009', definition: '조작' }],
    }
    expect(validateIssueAnalysisProcessDefinitions(forged, majors).ok).toBe(false)
  })
  it('Major 누락·중복을 거부한다', () => {
    expect(validateIssueAnalysisProcessDefinitions(
      { ...VALID_DEFS, majors: [VALID_DEFS.majors[0]] }, majors).ok).toBe(false)
    expect(validateIssueAnalysisProcessDefinitions(
      { ...VALID_DEFS, majors: [VALID_DEFS.majors[0], VALID_DEFS.majors[0]] }, majors).ok).toBe(false)
  })
  it('길이 상한과 빈 정의를 거부한다', () => {
    expect(validateIssueAnalysisProcessDefinitions(
      { ...VALID_DEFS, megaDefinition: '가'.repeat(201) }, majors).ok).toBe(false)
    expect(validateIssueAnalysisProcessDefinitions(
      {
        ...VALID_DEFS,
        majors: [VALID_DEFS.majors[0], { majorId: majors[1].id, definition: '가'.repeat(151) }],
      }, majors).ok).toBe(false)
    expect(validateIssueAnalysisProcessDefinitions(
      { ...VALID_DEFS, megaDefinition: '  ' }, majors).ok).toBe(false)
  })
  it('majors가 빈 입력이면 빈 배열 + megaDefinition을 요구한다', () => {
    expect(validateIssueAnalysisProcessDefinitions(
      { megaDefinition: '영역 정의', majors: [] }, []).ok).toBe(true)
    expect(validateIssueAnalysisProcessDefinitions(
      { megaDefinition: '영역 정의', majors: VALID_DEFS.majors }, []).ok).toBe(false)
  })
})

describe('v3 프롬프트·통합 파스', () => {
  it('프롬프트 버전이 v3다', () => {
    expect(ISSUE_ANALYSIS_PROMPT_VERSION).toBe('issue-causes-opportunities-defs-v3')
  })
  it('majors가 minimum envelope에 포함된다', () => {
    const prompt = buildIssueAnalysisMegaPrompt('02', '영업', [reportIssue], PROMPT_MAJORS)
    expect(prompt).toContain('majorId')
    expect(prompt).toContain('02.01')
  })
  it('시스템 프롬프트가 processDefinitions 스키마를 요구한다', () => {
    expect(ISSUE_ANALYSIS_SYSTEM_PROMPT).toContain('processDefinitions')
    expect(ISSUE_ANALYSIS_SYSTEM_PROMPT).toContain('megaDefinition')
  })
  it('개선기회+정의를 한 응답에서 파스한다', () => {
    const raw = JSON.stringify({
      opportunities: [{ title: '개선', description: '설명', issueIds: [reportIssue.id] }],
      processDefinitions: VALID_DEFS,
    })
    const result = parseIssueAnalysisAreaGeneration(
      raw,
      [reportIssue],
      PROMPT_MAJORS.map(major => ({ id: major.majorId })),
    )
    expect(result.ok).toBe(true)
  })
  it('정의가 빠진 응답을 거부한다', () => {
    const raw = JSON.stringify({
      opportunities: [{ title: '개선', description: '설명', issueIds: [reportIssue.id] }],
    })
    expect(parseIssueAnalysisAreaGeneration(raw, [reportIssue], []).ok).toBe(false)
  })
})
```

(`reportIssue`는 이 파일의 기존 `IssueAnalysisReportIssue` 픽스처를 재사용한다 — Task 2 이후 `majorId: null` 필드가 필요하면 픽스처에 추가한다.)

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ai/issue-analysis.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

버전 상수 교체:

```ts
export const ISSUE_ANALYSIS_PROMPT_VERSION = 'issue-causes-opportunities-defs-v3'
```

`ISSUE_ANALYSIS_SYSTEM_PROMPT` 마지막 두 줄(스키마 안내)을 다음으로 교체:

```ts
  'majors 배열의 각 Major에 대해 processDefinitions를 함께 작성하라. 해당 Major의 이슈·Sub Process를 근거로 하되, 이슈가 없는 Major는 이름을 근거로 일반적인 정의 초안을 작성하라.',
  `megaDefinition은 ${ISSUE_ANALYSIS_MEGA_DEFINITION_MAX}자, 각 Major definition은 ${ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX}자를 넘지 않는 명사형 종결("…을 관리하는 프로세스")의 완결된 문장으로 작성하라.`,
  'processDefinitions.majors에는 입력 majors의 각 majorId가 정확히 한 번씩 나타나야 하며, 입력에 없는 majorId를 만들지 마라. majors가 비어 있으면 "majors":[]로 출력하라.',
  '응답은 설명, Markdown, 코드 펜스 없이 아래 스키마의 JSON 객체 하나만 출력하라.',
  '{"opportunities":[{"title":"간결한 개선기회명","description":"근거 이슈에 기반한 개선 방향","issueIds":["입력 UUID"]}],"processDefinitions":{"megaDefinition":"Mega 프로세스 정의","majors":[{"majorId":"입력 majorId","definition":"Major 프로세스 정의"}]}}',
```

(model import에 `ISSUE_ANALYSIS_MEGA_DEFINITION_MAX`, `ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX`, `IssueAnalysisAreaMajor`, `IssueAnalysisAreaProcessDefinitions` 추가.)

타입·payload·prompt:

```ts
export interface IssueAnalysisPromptMajor {
  majorId: string
  seqLabel: string
  name: string
  subProcesses: string[]
  issueCount: number
}
```

`promptPayload(megaCode, megaName, issues, evidenceLimit, majors?)`로 확장 — 반환 객체를:

```ts
  return safePromptJson({
    megaCode,
    megaName,
    ...(majors === undefined ? {} : { majors }),
    issues: issues.map(issue => ({ /* 기존 그대로 */ })),
  })
```

`buildIssueAnalysisMegaPrompt(megaCode, megaName, issues, majors?)` — `minimum`/`result`의 `promptPayload` 호출 3곳에 `majors`를 그대로 전달(축약 대상 아님 — id/제목과 같은 취급). `buildIssueAnalysisCausePrompt`는 변경 없음(= majors 미전달).

검증·파스:

```ts
export type ProcessDefinitionsValidationResult =
  | { ok: true; value: IssueAnalysisAreaProcessDefinitions }
  | { ok: false; error: string }

/**
 * 정의-Major 연결 불변식: 입력 majors 전원이 정확히 한 번, 조작 id 금지,
 * 길이 상한·제어문자 금지. 출력은 입력 majors 순서로 정규화한다.
 */
export function validateIssueAnalysisProcessDefinitions(
  value: unknown,
  majors: readonly Pick<IssueAnalysisAreaMajor, 'id'>[],
): ProcessDefinitionsValidationResult {
  const object = record(value)
  if (!object) return { ok: false, error: 'processDefinitions가 객체가 아닙니다.' }
  const megaDefinition = typeof object.megaDefinition === 'string'
    ? object.megaDefinition.trim()
    : ''
  if (
    !megaDefinition
    || megaDefinition.length > ISSUE_ANALYSIS_MEGA_DEFINITION_MAX
    || UNSAFE_ANALYSIS_CONTROL_RE.test(megaDefinition)
  ) {
    return { ok: false, error: 'Mega 프로세스 정의가 없거나 너무 깁니다.' }
  }
  if (!Array.isArray(object.majors)) {
    return { ok: false, error: 'processDefinitions.majors가 배열이 아닙니다.' }
  }
  if (object.majors.length !== majors.length) {
    return {
      ok: false,
      error: `Major 정의 수(${object.majors.length})가 입력 Major 수(${majors.length})와 일치하지 않습니다.`,
    }
  }
  const validIds = new Set(majors.map(major => major.id))
  const byId = new Map<string, string>()
  for (let index = 0; index < object.majors.length; index += 1) {
    const item = record(object.majors[index])
    const majorId = item && typeof item.majorId === 'string' ? item.majorId.trim() : ''
    const definition = item && typeof item.definition === 'string' ? item.definition.trim() : ''
    if (!majorId || !validIds.has(majorId)) {
      return { ok: false, error: `${index + 1}번째 Major 정의가 입력에 없는 majorId를 참조합니다.` }
    }
    if (byId.has(majorId)) {
      return { ok: false, error: `Major ${majorId}의 정의가 중복되었습니다.` }
    }
    if (
      !definition
      || definition.length > ISSUE_ANALYSIS_MAJOR_DEFINITION_MAX
      || UNSAFE_ANALYSIS_CONTROL_RE.test(definition)
    ) {
      return { ok: false, error: `${index + 1}번째 Major 정의가 없거나 너무 깁니다.` }
    }
    byId.set(majorId, definition)
  }
  return {
    ok: true,
    value: {
      megaDefinition,
      majors: majors.map(major => ({
        majorId: major.id,
        definition: byId.get(major.id) as string,
      })),
    },
  }
}

export interface IssueAnalysisAreaGeneration {
  opportunities: IssueAnalysisOpportunity[]
  processDefinitions: IssueAnalysisAreaProcessDefinitions
}

export function parseIssueAnalysisAreaGeneration(
  raw: string,
  issues: readonly Pick<IssueAnalysisReportIssue, 'id'>[],
  majors: readonly Pick<IssueAnalysisAreaMajor, 'id'>[],
): { ok: true; value: IssueAnalysisAreaGeneration } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(cleanJsonResponse(raw))
  } catch {
    return { ok: false, error: 'AI 응답이 유효한 JSON이 아닙니다.' }
  }
  const object = record(parsed)
  if (!object) return { ok: false, error: 'AI 응답 최상위 값이 객체가 아닙니다.' }
  const opportunities = validateIssueAnalysisOpportunities(object.opportunities, issues)
  if (!opportunities.ok) return opportunities
  const processDefinitions = validateIssueAnalysisProcessDefinitions(
    object.processDefinitions,
    majors,
  )
  if (!processDefinitions.ok) return processDefinitions
  return {
    ok: true,
    value: { opportunities: opportunities.value, processDefinitions: processDefinitions.value },
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/ai/issue-analysis.test.ts` / Expected: PASS. 주의: 이 파일의 기존 `ISSUE_ANALYSIS_PROMPT_VERSION`·시스템 프롬프트 문자열 단언이 있으면 v3 기준으로 갱신한다.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/issue-analysis.ts tests/ai/issue-analysis.test.ts
git commit -m "feat(issues-ppt): 프롬프트 v3 — 개선기회 호출에 프로세스 정의 생성 편입

무료 티어 RPM을 지키기 위해 별도 호출 대신 기존 Mega별 호출의 입출력
스키마를 확장한다. 정의는 majors 전원 1:1·조작 금지·길이 상한으로
검증하고, 버전 bump로 v2 캐시와 자연 격리된다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 로더·ensure·액션 배선 — 정의가 저장 실행에 담긴다

**Files:**
- Modify: `src/lib/data/issueAnalysis.ts`, `src/lib/ai/issue-analysis.ts`, `src/app/actions/issueAnalysis.ts`
- Test: `tests/report/issue-analysis-loader.test.ts`, `tests/ai/issue-analysis-ensure.test.ts`, `tests/actions/issue-analysis.test.ts`, `tests/data/issue-analysis-run.test.ts`, `tests/api/issue-analysis-route.test.ts` 회귀

**Interfaces:**
- Produces:
  - `loadIssueAnalysisIssues(projectId, megaCode?)` → `Promise<{ issues: IssueAnalysisIssueInput[]; majors: IssueAnalysisMajorProcess[] }>` — majors는 **프로젝트 전체**(scope 필터와 무관), `(megaCode, majorSeq)` 정렬. mega 코드가 정본 목록에 없으면 throw(fail-closed).
  - `ensureIssueAnalysis(projectId, issues, majors: readonly IssueAnalysisMajorProcess[], createdBy)` — 스냅샷에 majors 포함, opportunity 태스크가 정의까지 생성·검증, `buildIssueAnalysisReport(..., processDefinitions)` 저장.
  - `reportFromCache`: populated area에 `processDefinitions` 키가 없으면 null(v3 캐시 방어), 있으면 스냅샷 majors 기준 재검증.

- [ ] **Step 1: 실패 테스트** — (a) `tests/report/issue-analysis-loader.test.ts`: 반환 구조 변경 반영 — 기존 단언의 `result`를 `result.issues`로 바꾸고 majors 케이스 추가:

```ts
  it('Major 기준정보를 mega·seq 순으로 함께 반환한다', async () => {
    // 기존 supabase mock의 issue_major_processes 응답에
    // [{ id: 'm2', mega_code: '02', major_seq: 2, name: '수출관리' },
    //  { id: 'm1', mega_code: '02', major_seq: 1, name: '주문관리' },
    //  { id: 'm0', mega_code: '00', major_seq: 1, name: '품목기준정보' }] 를 넣고
    const { majors } = await loadIssueAnalysisIssues('project-1')
    expect(majors.map(major => major.id)).toEqual(['m0', 'm1', 'm2'])
    expect(majors[1]).toEqual({ id: 'm1', megaCode: '02', majorSeq: 1, name: '주문관리' })
  })
  it('알 수 없는 mega 코드의 Major 행이 오면 throw한다', async () => {
    // mega_code: '99' 행 주입 → rejects.toThrow('Major')
  })
```

(b) `tests/ai/issue-analysis-ensure.test.ts`: `ensureIssueAnalysis(projectId, issues, majors, createdBy)` 4-인자 호출로 전환. `generateAnswer` mock의 **개선기회 응답**(cause가 아닌 호출 — 기존 mock이 프롬프트 내용으로 분기)에 `"processDefinitions"`를 추가한다. majors 픽스처는 이슈의 megaCode와 일치시키고 이슈 픽스처에 `majorId`를 넣는다:

```ts
const majorFor = (megaCode: '00' | '01' | '02') => ({
  id: `aaaa0000-0000-4000-8000-0000000000${megaCode}`,
  megaCode,
  majorSeq: 1,
  name: `${megaCode} 대표 프로세스`,
})
// issue() 픽스처에 majorId: majorFor(megaCode).id 추가
// 개선기회 mock 응답에:
//   processDefinitions: { megaDefinition: '…프로세스임',
//     majors: [{ majorId: majorFor(megaCode).id, definition: '…하는 프로세스' }] }
  it('생성 결과에 majors와 processDefinitions가 저장된다', async () => {
    const result = await ensureIssueAnalysis('project-1', issues, majors, 'user-1')
    expect(result.state).toBe('generated')
    if (result.state !== 'generated') return
    const area = result.analysis.areas.find(area => area.megaCode === '02')!
    expect(area.majors?.length).toBe(1)
    expect(area.processDefinitions?.majors[0]?.definition).toContain('프로세스')
    const stored = mocks.upserts[0]?.analysis_json as { areas: Array<Record<string, unknown>> }
    expect(stored.areas.find(area => area.megaCode === '02'))
      .toHaveProperty('processDefinitions')
  })
  it('정의가 빠진 개선기회 응답은 invalid_response로 실패한다', async () => {
    // mock에서 processDefinitions 제거 → state 'unavailable', reason 'invalid_response'
  })
```

(c) `tests/actions/issue-analysis.test.ts` / `tests/data/issue-analysis-run.test.ts`: 로더 mock 반환을 `{ issues, majors: [] }` 형태로, `ensureIssueAnalysis` mock 시그니처를 4-인자로 갱신(동작 단언은 기존 유지).

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/issue-analysis-loader.test.ts tests/ai/issue-analysis-ensure.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

(a) 로더 — `src/lib/data/issueAnalysis.ts`:

```ts
import type { IssueAnalysisMajorProcess } from '@/lib/report/issues/model'

export interface IssueAnalysisLoadResult {
  issues: IssueAnalysisIssueInput[]
  majors: IssueAnalysisMajorProcess[]
}
```

함수 시그니처를 `Promise<IssueAnalysisLoadResult>`로 바꾸고, `majorById` 구성 아래에:

```ts
  const majors: IssueAnalysisMajorProcess[] = (
    majorsResult.data as unknown as Record<string, unknown>[]
  ).map(raw => {
    const megaCode = raw.mega_code
    if (!isIssueMegaCode(megaCode)) {
      throw new Error(`[issue-analysis] Major 기준정보의 Mega 코드가 올바르지 않습니다: ${String(megaCode)}`)
    }
    const majorSeq = Number(raw.major_seq)
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!Number.isSafeInteger(majorSeq) || majorSeq < 1 || !name) {
      throw new Error('[issue-analysis] Major 기준정보 행이 올바르지 않습니다.')
    }
    return { id: String(raw.id), megaCode, majorSeq, name }
  }).sort((a, b) =>
    a.megaCode.localeCompare(b.megaCode) || a.majorSeq - b.majorSeq)
```

기존 이슈 매핑 배열을 `issues` 변수로 받아 `return { issues, majors }`.

(b) ensure — `src/lib/ai/issue-analysis.ts`:

- `ensureIssueAnalysis(projectId, issues, majors, createdBy)` — `buildIssueAnalysisInputSnapshot(projectId, issues, majors)`.
- 영역별 프롬프트 majors 도우미:

```ts
function promptMajors(
  area: IssueAnalysisInputSnapshot['areas'][number],
): IssueAnalysisPromptMajor[] {
  return area.majors.map(major => {
    const majorIssues = area.issues.filter(issue => issue.majorId === major.id)
    const subProcesses: string[] = []
    for (const issue of majorIssues) {
      const sub = compact(issue.subProcess)
      if (sub && !subProcesses.includes(sub)) subProcesses.push(sub)
    }
    return {
      majorId: major.id,
      seqLabel: `${area.megaCode}.${String(major.majorSeq).padStart(2, '0')}`,
      name: major.name,
      subProcesses,
      issueCount: majorIssues.length,
    }
  })
}
```

- `ensureIssueAnalysisSnapshot`에 `const processDefinitions: Partial<Record<IssueMegaCode, IssueAnalysisAreaProcessDefinitions>> = {}` 추가. opportunity 태스크 타입에 `majors: IssueAnalysisAreaMajor[]` 필드를 더하고 생성부에서:

```ts
      tasks.push({
        kind: 'opportunity',
        megaCode: area.megaCode,
        megaName: area.megaName,
        issues: area.issues,
        majors: area.majors,
        prompt: buildIssueAnalysisMegaPrompt(
          area.megaCode,
          area.megaName,
          area.issues,
          promptMajors(area),
        ),
      })
```

- worker의 opportunity 분기를 `parseIssueAnalysisAreaGeneration(raw, task.issues, task.majors)`로 교체하고 성공 시 `opportunities[task.megaCode] = parsed.value.opportunities; processDefinitions[task.megaCode] = parsed.value.processDefinitions`.
- 최종 `buildIssueAnalysisReport(snapshot, opportunities, new Date().toISOString(), causeAnalyses, processDefinitions)`.
- `reportFromCache`: causeAnalyses hasOwnProperty 검사 옆에 `processDefinitions` 검사 추가 + 검증:

```ts
    if (
      !cachedAreaObject
      || !Object.prototype.hasOwnProperty.call(cachedAreaObject, 'causeAnalyses')
      || !Object.prototype.hasOwnProperty.call(cachedAreaObject, 'processDefinitions')
    ) return null
    const validatedDefinitions = validateIssueAnalysisProcessDefinitions(
      cachedAreaObject.processDefinitions,
      area.majors,
    )
    if (!validatedDefinitions.ok) return null
    processDefinitions[area.megaCode] = validatedDefinitions.value
```

(`reportFromCache` 상단에 `processDefinitions` 누적 맵 추가, 마지막 `buildIssueAnalysisReport(snapshot, opportunities, object.generatedAt, causeAnalyses, processDefinitions)`.)

(c) 액션 — `src/app/actions/issueAnalysis.ts`:

```ts
  let issues
  let majors
  try {
    const loaded = await loadIssueAnalysisIssues(
      projectId,
      megaFilter === 'all' ? undefined : megaFilter,
    )
    issues = loaded.issues
    majors = loaded.majors
    // (scope 정합 검사 기존 그대로 — issues 기준)
  } catch ...
  ...
    const result = await ensureIssueAnalysis(projectId, issues, majors, guard.actor.userId)
```

- [ ] **Step 4: 통과 + 회귀** — Run: `npx vitest run tests/report/issue-analysis-loader.test.ts tests/ai/issue-analysis-ensure.test.ts tests/actions/issue-analysis.test.ts tests/data/issue-analysis-run.test.ts tests/api/issue-analysis-route.test.ts` / Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/issueAnalysis.ts src/lib/ai/issue-analysis.ts src/app/actions/issueAnalysis.ts tests/report/issue-analysis-loader.test.ts tests/ai/issue-analysis-ensure.test.ts tests/actions/issue-analysis.test.ts tests/data/issue-analysis-run.test.ts
git commit -m "feat(issues-ppt): 로더·ensure에 Major 기준정보 배선 — 정의가 실행 저장본에 포함

PPT는 저장 실행에서만 렌더되므로 정의도 같은 실행에 원자적으로 저장한다.
부분 Mega 결과 미저장·캐시 재검증 원칙은 기존 그대로이며, 정의 없는
캐시 행은 재사용하지 않는다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: processPages 덱 플랜 — 트리 열·정의 행·슬라이드 배치

**Files:**
- Create: `src/lib/report/issues/processPages.ts`
- Modify: `src/lib/report/issues/deckPlan.ts`, `docs/superpowers/specs/2026-08-02-issue-analysis-process-pages-design.md`(§5 정의 슬라이드에 headline 추가 반영)
- Test: `tests/report/issue-analysis-process-pages.test.ts` (신규), `tests/report/issue-analysis-deck-plan.test.ts` 회귀

**Interfaces:**
- Consumes: `IssueAnalysisReportArea`(model), Task 2 필드.
- Produces (`processPages.ts`):

```ts
export const ISSUE_ANALYSIS_TREE_COLUMN_CAPACITY = 8
export const ISSUE_ANALYSIS_TREE_SUB_CAPACITY = 6
export const ISSUE_ANALYSIS_DEFINITION_ROW_CAPACITY = 4
export const ISSUE_ANALYSIS_UNCLASSIFIED_MAJOR_LABEL = '(미지정)'

export interface IssueAnalysisDeckTreeColumn {
  label: string
  continuation: boolean
  subs: string[]
}
export interface IssueAnalysisDeckDefinitionRow {
  seqLabel: string
  name: string
  definition: string
}
export interface IssueAnalysisDeckProcessTreeSlide {
  kind: 'process-tree'
  sourceSlide: 5
  megaCode: string
  megaName: string
  pageInSeries: number
  pageCount: number
  headline: string
  columns: IssueAnalysisDeckTreeColumn[]
}
export interface IssueAnalysisDeckProcessDefinitionSlide {
  kind: 'process-definition'
  sourceSlide: 6
  megaCode: string
  megaName: string
  pageInSeries: number
  pageCount: number
  headline: string
  megaDefinition: string
  rows: IssueAnalysisDeckDefinitionRow[]
}
export type IssueAnalysisDeckProcessSlide =
  | IssueAnalysisDeckProcessTreeSlide
  | IssueAnalysisDeckProcessDefinitionSlide
export function buildIssueAnalysisProcessSlides(
  area: IssueAnalysisReportArea,
): IssueAnalysisDeckProcessSlide[]
```

- `deckPlan.ts`: `IssueAnalysisDeckSlide` union에 두 타입 추가, populated 영역 루프 선두에 `slides.push(...buildIssueAnalysisProcessSlides(area))`, 계약 주석의 "5~7 프로세스 체계 제외"를 "5 트리·6 정의 — processDefinitions 저장 실행에서만, 7 미사용(6과 같은 레이아웃)"으로 갱신.

- [ ] **Step 1: 실패 테스트 작성** — `tests/report/issue-analysis-process-pages.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ISSUE_ANALYSIS_UNCLASSIFIED_MAJOR_LABEL,
  buildIssueAnalysisProcessSlides,
} from '@/lib/report/issues/processPages'
import { buildIssueAnalysisDeckPlan } from '@/lib/report/issues/deckPlan'
import type { IssueAnalysisReportArea } from '@/lib/report/issues/model'

const majorId = (n: number) => `aaaa0000-0000-4000-8000-${String(n).padStart(12, '0')}`

function areaFixture(overrides: {
  majorCount?: number
  subsPerMajor?: number
  unclassifiedSubs?: number
  withDefinitions?: boolean
} = {}): IssueAnalysisReportArea {
  const {
    majorCount = 2, subsPerMajor = 2, unclassifiedSubs = 0, withDefinitions = true,
  } = overrides
  const majors = Array.from({ length: majorCount }, (_, i) => ({
    id: majorId(i + 1), majorSeq: i + 1, name: `프로세스${i + 1}`,
  }))
  let seq = 0
  const issues = [
    ...majors.flatMap(major =>
      Array.from({ length: subsPerMajor }, (_, s) => {
        seq += 1
        return issueFixture({ megaSeq: seq, majorId: major.id, subProcess: `${major.name}-업무${s + 1}` })
      })),
    ...Array.from({ length: unclassifiedSubs }, (_, s) => {
      seq += 1
      return issueFixture({ megaSeq: seq, majorId: null, subProcess: `미지정업무${s + 1}` })
    }),
  ]
  return {
    megaCode: '02', megaName: '영업', megaNameEn: 'Sales',
    majors,
    summary: summaryFixture(issues),
    issues,
    opportunities: [],
    ...(withDefinitions
      ? {
          processDefinitions: {
            megaDefinition: '고객 주문 이행 전반을 관리하는 프로세스임',
            majors: majors.map(major => ({
              majorId: major.id,
              definition: `${major.name}를 관리하는 프로세스`,
            })),
          },
        }
      : {}),
  }
}
// issueFixture/summaryFixture는 tests/report/issue-analysis-deck-plan.test.ts의
// 기존 이슈·summary 생성 헬퍼를 이 파일로 복사해 megaSeq·majorId·subProcess를
// 파라미터화한 것(piIssueCode는 megaSeq와 일치시킨다).

describe('buildIssueAnalysisProcessSlides', () => {
  it('processDefinitions 없는 구버전 영역은 빈 배열(기존 덱 무변경)', () => {
    expect(buildIssueAnalysisProcessSlides(areaFixture({ withDefinitions: false }))).toEqual([])
  })

  it('기본형: 트리 1페이지 + 정의 1페이지, 배치·헤드라인·seqLabel', () => {
    const slides = buildIssueAnalysisProcessSlides(areaFixture())
    expect(slides.map(slide => slide.kind)).toEqual(['process-tree', 'process-definition'])
    const tree = slides[0] as Extract<typeof slides[number], { kind: 'process-tree' }>
    expect(tree.columns.map(column => column.label)).toEqual(['프로세스1', '프로세스2'])
    expect(tree.columns[0].subs).toEqual(['프로세스1-업무1', '프로세스1-업무2'])
    expect(tree.headline).toBe(
      '현행 영업 프로세스는 프로세스1,프로세스2 2개의 Major 프로세스와 4개의 Sub 프로세스로 구성됨',
    )
    const definition = slides[1] as Extract<typeof slides[number], { kind: 'process-definition' }>
    expect(definition.rows[0]).toEqual({
      seqLabel: '02.01', name: '프로세스1', definition: '프로세스1를 관리하는 프로세스',
    })
    expect(definition.headline).toBe(tree.headline)
    expect(definition.megaDefinition).toContain('주문 이행')
  })

  it('Major 4개 초과는 등 …N개 헤드라인과 정의 페이지 분할', () => {
    const slides = buildIssueAnalysisProcessSlides(areaFixture({ majorCount: 5, subsPerMajor: 1 }))
    const definitions = slides.filter(slide => slide.kind === 'process-definition')
    expect(definitions.map(slide => slide.rows.length)).toEqual([4, 1])
    expect(definitions[0].pageCount).toBe(2)
    expect(definitions[1].pageInSeries).toBe(2)
    expect(slides[0].headline).toContain('프로세스1,프로세스2,프로세스3 등 5개의 Major')
  })

  it('열 8개 초과는 트리 페이지 분할, Sub 7개는 (계속) 열', () => {
    const slides = buildIssueAnalysisProcessSlides(
      areaFixture({ majorCount: 8, subsPerMajor: 1, unclassifiedSubs: 0 }),
    )
    expect(slides.filter(slide => slide.kind === 'process-tree')).toHaveLength(1)

    const overflow = buildIssueAnalysisProcessSlides(areaFixture({ majorCount: 9, subsPerMajor: 1 }))
    const trees = overflow.filter(slide => slide.kind === 'process-tree')
    expect(trees.map(tree => tree.columns.length)).toEqual([8, 1])
    expect(trees[1].pageInSeries).toBe(2)

    const contin = buildIssueAnalysisProcessSlides(areaFixture({ majorCount: 1, subsPerMajor: 7 }))
    const tree = contin[0] as Extract<typeof contin[number], { kind: 'process-tree' }>
    expect(tree.columns.map(column => [column.label, column.subs.length, column.continuation]))
      .toEqual([['프로세스1', 6, false], ['프로세스1(계속)', 1, true]])
  })

  it('미지정 이슈는 마지막 (미지정) 열, 정의 페이지 제외, 헤드라인 카운트 규칙', () => {
    const slides = buildIssueAnalysisProcessSlides(
      areaFixture({ majorCount: 1, subsPerMajor: 1, unclassifiedSubs: 2 }),
    )
    const tree = slides[0] as Extract<typeof slides[number], { kind: 'process-tree' }>
    expect(tree.columns.at(-1)?.label).toBe(ISSUE_ANALYSIS_UNCLASSIFIED_MAJOR_LABEL)
    expect(tree.columns.at(-1)?.subs).toEqual(['미지정업무1', '미지정업무2'])
    expect(tree.headline).toContain('1개의 Major 프로세스와 3개의 Sub 프로세스')
    const definitions = slides.filter(slide => slide.kind === 'process-definition')
    expect(definitions[0].rows).toHaveLength(1)
  })

  it('Major 0 + 전부 미지정이면 트리만 나오고 정의 페이지가 없다', () => {
    const slides = buildIssueAnalysisProcessSlides(
      areaFixture({ majorCount: 0, subsPerMajor: 0, unclassifiedSubs: 2 }),
    )
    expect(slides.every(slide => slide.kind === 'process-tree')).toBe(true)
    expect(slides[0].headline).toBe('현행 영업 프로세스는 Major 미지정 2개의 Sub 프로세스로 구성됨')
  })

  it('Sub 0개 Major도 빈 열 1개를 차지한다', () => {
    const area = areaFixture({ majorCount: 2, subsPerMajor: 0, unclassifiedSubs: 1 })
    const tree = buildIssueAnalysisProcessSlides(area)[0] as
      Extract<ReturnType<typeof buildIssueAnalysisProcessSlides>[number], { kind: 'process-tree' }>
    expect(tree.columns.map(column => [column.label, column.subs.length]))
      .toEqual([['프로세스1', 0], ['프로세스2', 0], ['(미지정)', 1]])
  })

  it('정합 파손은 throw — 정의 누락 Major, 목록 밖 majorId', () => {
    const missingDefinition = areaFixture()
    missingDefinition.processDefinitions!.majors.pop()
    expect(() => buildIssueAnalysisProcessSlides(missingDefinition)).toThrow('정의')

    const orphan = areaFixture()
    orphan.issues[0] = { ...orphan.issues[0], majorId: majorId(99) }
    expect(() => buildIssueAnalysisProcessSlides(orphan)).toThrow('Major')
  })
})

describe('buildIssueAnalysisDeckPlan 통합', () => {
  it('영역 순서가 트리→정의→이슈 종합이고, 구버전 보고서는 기존 순서 그대로다', () => {
    // 기존 deck-plan 테스트의 report 픽스처를 재사용해:
    //  (a) majors/processDefinitions 없는 report → kinds에 process-* 없음
    //  (b) '02' area에 majors+defs 추가한 report → kinds가
    //      [..., 'process-tree', 'process-definition', 'area-summary', ...] 순서
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/issue-analysis-process-pages.test.ts` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: `processPages.ts` 구현**

```ts
import type { IssueAnalysisReportArea } from './model'

export const ISSUE_ANALYSIS_TREE_COLUMN_CAPACITY = 8
export const ISSUE_ANALYSIS_TREE_SUB_CAPACITY = 6
export const ISSUE_ANALYSIS_DEFINITION_ROW_CAPACITY = 4
export const ISSUE_ANALYSIS_UNCLASSIFIED_MAJOR_LABEL = '(미지정)'

// (Interfaces 블록의 타입 선언 그대로)

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    pages.push(items.slice(start, start + size))
  }
  return pages
}

/**
 * Major(seq순)별 이슈 구분 고유값을 열로 편성한다. 전량 유지 원칙:
 * 열당 6칸을 넘으면 "이름(계속)" 연속 열, Sub 0개 Major도 빈 열을 차지한다.
 */
function treeColumns(area: IssueAnalysisReportArea): IssueAnalysisDeckTreeColumn[] {
  const majors = area.majors ?? []
  const majorIds = new Set(majors.map(major => major.id))
  const subsByKey = new Map<string, string[]>()
  for (const issue of area.issues) {
    if (issue.majorId !== null && !majorIds.has(issue.majorId)) {
      throw new Error(
        `${area.megaName} ${issue.piIssueCode} 이슈가 영역 Major 목록에 없는 Major를 참조합니다.`,
      )
    }
    const sub = compactText(issue.subProcess)
    if (!sub) {
      throw new Error(`${area.megaName} ${issue.piIssueCode} 이슈의 Sub Process가 비어 있습니다.`)
    }
    const key = issue.majorId ?? ''
    const list = subsByKey.get(key)
    if (!list) subsByKey.set(key, [sub])
    else if (!list.includes(sub)) list.push(sub)
  }

  const columns: IssueAnalysisDeckTreeColumn[] = []
  const pushColumns = (label: string, subs: readonly string[]) => {
    if (!subs.length) {
      columns.push({ label, continuation: false, subs: [] })
      return
    }
    chunk(subs, ISSUE_ANALYSIS_TREE_SUB_CAPACITY).forEach((page, index) => {
      columns.push({
        label: index === 0 ? label : `${label}(계속)`,
        continuation: index > 0,
        subs: page,
      })
    })
  }
  for (const major of majors) pushColumns(major.name, subsByKey.get(major.id) ?? [])
  const unclassified = subsByKey.get('')
  if (unclassified?.length) pushColumns(ISSUE_ANALYSIS_UNCLASSIFIED_MAJOR_LABEL, unclassified)
  return columns
}

function treeHeadline(
  area: IssueAnalysisReportArea,
  columns: readonly IssueAnalysisDeckTreeColumn[],
): string {
  const majors = area.majors ?? []
  const subCount = columns.reduce((sum, column) => sum + column.subs.length, 0)
  if (!majors.length) {
    return `현행 ${area.megaName} 프로세스는 Major 미지정 ${subCount}개의 Sub 프로세스로 구성됨`
  }
  const names = majors.map(major => major.name)
  const listed = names.slice(0, 3).join(',')
  const suffix = names.length > 3 ? ' 등' : ''
  return `현행 ${area.megaName} 프로세스는 ${listed}${suffix} ${majors.length}개의 Major 프로세스와 ${subCount}개의 Sub 프로세스로 구성됨`
}

/** 저장 실행에 정의가 있는 영역만 트리→정의 순의 슬라이드 시리즈를 만든다. */
export function buildIssueAnalysisProcessSlides(
  area: IssueAnalysisReportArea,
): IssueAnalysisDeckProcessSlide[] {
  const definitions = area.processDefinitions
  const majors = area.majors
  if (!definitions || !majors || !area.issues.length) return []

  const columns = treeColumns(area)
  const headline = treeHeadline(area, columns)
  const treePages = chunk(columns, ISSUE_ANALYSIS_TREE_COLUMN_CAPACITY)
  const slides: IssueAnalysisDeckProcessSlide[] = treePages.map((pageColumns, index) => ({
    kind: 'process-tree',
    sourceSlide: 5,
    megaCode: area.megaCode,
    megaName: area.megaName,
    pageInSeries: index + 1,
    pageCount: treePages.length,
    headline,
    columns: pageColumns,
  }))

  const definitionById = new Map(
    definitions.majors.map(major => [major.majorId, major.definition]),
  )
  if (definitionById.size !== definitions.majors.length) {
    throw new Error(`${area.megaName} 프로세스 정의에 중복 Major가 있습니다.`)
  }
  const rows = majors.map(major => {
    const definition = definitionById.get(major.id)
    if (definition === undefined) {
      throw new Error(`${area.megaName} ${major.name} Major의 프로세스 정의가 없습니다.`)
    }
    return {
      seqLabel: `${area.megaCode}.${String(major.majorSeq).padStart(2, '0')}`,
      name: major.name,
      definition,
    }
  })
  const definitionPages = chunk(rows, ISSUE_ANALYSIS_DEFINITION_ROW_CAPACITY)
  definitionPages.forEach((pageRows, index) => {
    slides.push({
      kind: 'process-definition',
      sourceSlide: 6,
      megaCode: area.megaCode,
      megaName: area.megaName,
      pageInSeries: index + 1,
      pageCount: definitionPages.length,
      headline,
      megaDefinition: definitions.megaDefinition,
      rows: pageRows,
    })
  })
  return slides
}
```

`deckPlan.ts`: import 추가, union에 `| IssueAnalysisDeckProcessTreeSlide | IssueAnalysisDeckProcessDefinitionSlide`, 영역 루프:

```ts
  for (const area of populatedAreas) {
    slides.push(...buildIssueAnalysisProcessSlides(area))
    slides.push(...areaSlides(area))
    slides.push(...causeAnalysisSlides(area))
  }
```

계약 주석 갱신 + 스펙 §5 타입 스케치에 `headline` 필드 반영(정의 슬라이드).

- [ ] **Step 4: 통과 + 회귀** — Run: `npx vitest run tests/report/issue-analysis-process-pages.test.ts tests/report/issue-analysis-deck-plan.test.ts` / Expected: PASS (구버전 픽스처의 기존 덱 순서 무변경)

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/issues/processPages.ts src/lib/report/issues/deckPlan.ts tests/report/issue-analysis-process-pages.test.ts "docs/superpowers/specs/2026-08-02-issue-analysis-process-pages-design.md"
git commit -m "feat(issues-ppt): 덱 플랜에 프로세스 트리·정의 페이지 배치 — 전량 유지 페이지네이션

사용자 결정(캡 금지)대로 Sub 초과는 (계속) 열, 열 초과는 페이지 분할로
전량 표시한다. 정의가 없는 구버전 저장 실행은 슬라이드 구성이 한 장도
변하지 않는다. 주의: 렌더러(다음 커밋) 전까지 새 실행 PPT는 명시적
에러가 되므로 이 커밋 단독 push 금지.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 트리·정의 슬라이드 렌더러

**Files:**
- Create: `src/lib/report/issues/processSlideRenderer.ts`
- Modify: `src/lib/report/issues/jszipRenderer.ts` (switch/expectedSourceSlide/validatePlan/slideMetadataTitle)
- Test: `tests/report/issue-analysis-process-render.test.ts` (신규), `tests/report/issue-analysis-export.test.ts` 회귀

**Interfaces:**
- Consumes: Task 1 프리미티브, Task 6 슬라이드 타입·상수, `ISSUE_MEGA_AREAS`.
- Produces:
  - `renderProcessTreeSlide(sourceXml, slide, plan, outputPage): string`
  - `renderProcessDefinitionSlide(sourceXml, slide, plan, outputPage): string`
  - jszipRenderer: `expectedSourceSlide`에 `'process-tree' → 5`, `'process-definition' → 6`; `renderSlide` switch 2 case; `validatePlan` 검사; `slideMetadataTitle` 2 case.

- [ ] **Step 1: 실패 테스트 작성** — `tests/report/issue-analysis-process-render.test.ts`. 기존 `tests/report/issue-analysis-export.test.ts`의 헬퍼 방식(실제 템플릿 로드 + `renderIssueAnalysisPptFromTemplate` + JSZip 재해부)을 따른다:

```ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { ISSUE_ANALYSIS_TEMPLATE_PATH } from '@/lib/report/issues/template'
import { renderIssueAnalysisPptFromTemplate } from '@/lib/report/issues/jszipRenderer'
import { buildIssueAnalysisDeckPlan } from '@/lib/report/issues/deckPlan'

// report 픽스처: tests/report/issue-analysis-process-pages.test.ts의 areaFixture와
// 같은 방식으로 '02' 영역에 majors 2개(주문관리·수출관리)+defs, 이슈 3건
// (주문관리 sub '주문접수/등록2건분리표시', 수출관리 sub 없음 = 빈 열,
//  미지정 1건 sub '미지정업무') + opportunities 1건 + causeAnalyses 구성.
// plan = buildIssueAnalysisDeckPlan(report, meta)

async function renderedSlides(plan: Parameters<typeof renderIssueAnalysisPptFromTemplate>[0]) {
  const template = await readFile(ISSUE_ANALYSIS_TEMPLATE_PATH)
  const bytes = await renderIssueAnalysisPptFromTemplate(plan, template)
  const zip = await JSZip.loadAsync(bytes)
  const slides: string[] = []
  for (let page = 1; zip.file(`ppt/slides/slide${page}.xml`); page += 1) {
    slides.push(await zip.file(`ppt/slides/slide${page}.xml`)!.async('string'))
  }
  return slides
}

describe('프로세스 트리 슬라이드 렌더', () => {
  it('체브론 8칸(정본 Mega명)과 활성 강조·제목·헤드라인·미지정 열을 그린다', async () => {
    const slides = await renderedSlides(plan)
    const tree = slides.find(xml => xml.includes('As-Is 프로세스 체계'))!
    expect(tree).toContain('기준관리')      // Mega 00 정본명 (템플릿 '기준정보' 대체)
    expect(tree).toContain('원가')
    expect(tree).toContain('주문관리')
    expect(tree).toContain('(미지정)')
    expect(tree).toContain('미지정업무')
    expect(tree).not.toContain('견적관리')  // 템플릿 셈플 Sub 전량 삭제 확인
    expect(tree).not.toContain('경매관리자')
  })
  it('사용하지 않는 Major 열 박스는 삭제된다', async () => {
    const slides = await renderedSlides(plan)
    const tree = slides.find(xml => xml.includes('As-Is 프로세스 체계'))!
    // 3열(주문관리·수출관리·미지정)만 사용 → 4번째 슬롯 박스(id 51) 부재
    expect(tree).not.toMatch(/<p:cNvPr\b[^>]*\bid="51"/)
    expect(tree).not.toMatch(/<p:cNvPr\b[^>]*\bid="92"/)
  })
})

describe('프로세스 정의 슬라이드 렌더', () => {
  it('Mega 정의·행 텍스트를 채우고 빈 행 도형을 삭제한다', async () => {
    const slides = await renderedSlides(plan)
    const definition = slides.find(xml => xml.includes('02.01 주문관리'))!
    expect(definition).toContain('02. 영업')
    expect(definition).toContain('주문 이행')            // megaDefinition
    expect(definition).toContain('02.02 수출관리')
    expect(definition).not.toMatch(/<p:cNvPr\b[^>]*\bid="58"/)  // 3·4행 삭제
    expect(definition).not.toMatch(/<p:cNvPr\b[^>]*\bid="60"/)
  })
})

describe('덱 검증', () => {
  it('열 9개짜리 트리 슬라이드는 렌더 전에 거부된다', async () => {
    // plan 복제 후 process-tree 슬라이드 columns를 9개로 조작
    await expect(renderIssueAnalysisPptFromTemplate(mutated, template))
      .rejects.toThrow('프로세스 트리')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/report/issue-analysis-process-render.test.ts` / Expected: FAIL (renderSlide가 새 kind를 모름 → '원본 매핑' 에러)

- [ ] **Step 3: `processSlideRenderer.ts` 구현**

```ts
import 'server-only'

import { ISSUE_MEGA_AREAS } from '@/lib/domain/issueAnalysis'
import {
  CONNECTOR_RE,
  SHAPE_RE,
  appendShapeTreeElements,
  deleteShapeOrConnector,
  readElementTransform,
  setPageFooter,
  setShapeElementText,
  setShapeText,
  singleElementById,
  withElementId,
  withElementTransform,
  withoutConnectorTargets,
} from './slideXml'
import type {
  IssueAnalysisDeckProcessDefinitionSlide,
  IssueAnalysisDeckProcessTreeSlide,
} from './processPages'
import type { IssueAnalysisDeckPlan } from './deckPlan'

// 표준 템플릿 5번 슬라이드 실측 ID (docs/superpowers/plans/2026-08-02 파일 구조 맵 참조)
const TREE_TITLE_ID = '146'
const TREE_HEADLINE_ID = '145'
const TREE_TAG_ID = '100'
const TREE_MAJOR_BOX_IDS = ['116', '102', '111', '51', '70', '77', '103', '92'] as const
const TREE_CHEVRON_IDS = ['128', '125', '135', '126', '134', '127', '129', '130'] as const
const TREE_CHEVRON_ACTIVE_ID = '135'
const TREE_CHEVRON_INACTIVE_ID = '128'
const TREE_SUB_PROTOTYPE_ID = '108'
const TREE_SUB_SECOND_ID = '107'
const TREE_SUB_PROTOTYPE_COLUMN = 1 // 프로토타입(108)이 속한 열 인덱스(2열)
const TREE_SPINE_PROTOTYPE_ID = '101'
const TREE_CONNECTOR_IDS = [
  '55', '60', '63', '66', '69', '73', '76', '83', '91',
  '101', '105', '106', '114', '115', '117',
] as const
const TREE_SUB_BOX_IDS = [
  '53', '54', '71', '72', '78', '79', '80', '86', '87', '93', '94',
  '107', '108', '109', '110', '113', '118', '119', '120', '121', '123',
  '136', '137', '139',
] as const

function seriesSuffix(pageInSeries: number, pageCount: number): string {
  return pageCount > 1 ? ` (${pageInSeries}/${pageCount})` : ''
}

/**
 * 템플릿 5번 슬라이드의 8열 고정 지오메트리를 재사용한다. 셈플 도형(Sub·커넥터·
 * 체브론)을 전부 지우고 프로토타입 복제로 실데이터 열을 다시 세운다. 체브론 부채꼴
 * 커넥터는 활성 Mega가 영역마다 달라 재계산이 필요하므로, 직선 버스 배관(활성 체브론
 * 하강선 + 수평 버스 + 열 하강선 + 열 스파인)으로 대체한다.
 */
export function renderProcessTreeSlide(
  sourceXml: string,
  slide: IssueAnalysisDeckProcessTreeSlide,
  plan: IssueAnalysisDeckPlan,
  outputPage: number,
): string {
  if (slide.columns.length < 1 || slide.columns.length > TREE_MAJOR_BOX_IDS.length) {
    throw new Error('[issue-analysis] 프로세스 트리 열 수가 올바르지 않습니다.')
  }

  // 프로토타입·슬롯 좌표는 삭제 전에 원본에서 확보한다.
  const chevronSlots = TREE_CHEVRON_IDS.map(id =>
    readElementTransform(singleElementById(sourceXml, SHAPE_RE, id, 'shape')))
  const chevronActivePrototype =
    singleElementById(sourceXml, SHAPE_RE, TREE_CHEVRON_ACTIVE_ID, 'shape')
  const chevronInactivePrototype =
    singleElementById(sourceXml, SHAPE_RE, TREE_CHEVRON_INACTIVE_ID, 'shape')
  const majorSlots = TREE_MAJOR_BOX_IDS.map(id =>
    readElementTransform(singleElementById(sourceXml, SHAPE_RE, id, 'shape')))
  const subPrototype = singleElementById(sourceXml, SHAPE_RE, TREE_SUB_PROTOTYPE_ID, 'shape')
  const subBase = readElementTransform(subPrototype)
  const subPitch = readElementTransform(
    singleElementById(sourceXml, SHAPE_RE, TREE_SUB_SECOND_ID, 'shape'),
  ).y - subBase.y
  const subOffsetX = subBase.x - majorSlots[TREE_SUB_PROTOTYPE_COLUMN].x
  const linePrototype = withoutConnectorTargets(
    singleElementById(sourceXml, CONNECTOR_RE, TREE_SPINE_PROTOTYPE_ID, 'connector'),
  )
  const spineTop = readElementTransform(linePrototype).y
  if (subPitch < 1) {
    throw new Error('[issue-analysis] 프로세스 트리 Sub 행 간격을 읽을 수 없습니다.')
  }

  const activeIndex = ISSUE_MEGA_AREAS.findIndex(area => area.code === slide.megaCode)
  if (activeIndex < 0) {
    throw new Error(`[issue-analysis] 알 수 없는 Mega 코드입니다: ${slide.megaCode}`)
  }

  let xml = setPageFooter(sourceXml, outputPage, plan.meta.authorName)
  xml = setShapeText(
    xml,
    TREE_TITLE_ID,
    `As-Is 프로세스 체계 – ${slide.megaCode}_${slide.megaName}${seriesSuffix(slide.pageInSeries, slide.pageCount)}`,
    true,
  )
  xml = setShapeText(xml, TREE_TAG_ID, '2. 영역 별 이슈 및 원인 분석서')
  xml = setShapeText(xml, TREE_HEADLINE_ID, slide.headline, true)

  for (const id of TREE_CONNECTOR_IDS) xml = deleteShapeOrConnector(xml, id)
  for (const id of TREE_SUB_BOX_IDS) xml = deleteShapeOrConnector(xml, id)
  for (const id of TREE_CHEVRON_IDS) xml = deleteShapeOrConnector(xml, id)
  for (let slot = slide.columns.length; slot < TREE_MAJOR_BOX_IDS.length; slot += 1) {
    xml = deleteShapeOrConnector(xml, TREE_MAJOR_BOX_IDS[slot])
  }
  slide.columns.forEach((column, index) => {
    xml = setShapeText(xml, TREE_MAJOR_BOX_IDS[index], column.label, true)
  })

  let nextShapeId = 2_000
  const takeShapeId = () => {
    const id = nextShapeId
    nextShapeId += 1
    return id
  }
  const connectors: string[] = []
  const shapes: string[] = []

  // 체브론 8칸 — Mega 정본 라벨, 현재 영역만 활성 스타일 프로토타입.
  ISSUE_MEGA_AREAS.forEach((mega, index) => {
    const prototype = index === activeIndex
      ? chevronActivePrototype
      : chevronInactivePrototype
    let shape = withElementId(prototype, takeShapeId())
    shape = withElementTransform(shape, chevronSlots[index])
    shape = setShapeElementText(shape, `${mega.code}\n${mega.nameKo}`, true)
    shapes.push(shape)
  })

  // 배관 지오메트리 — 활성 체브론 하강선 + 수평 버스 + 열 하강선 + 열 스파인.
  const chevronBottom = chevronSlots[activeIndex].y + chevronSlots[activeIndex].cy
  const majorTop = majorSlots[0].y
  const busY = chevronBottom + Math.floor((majorTop - chevronBottom) / 2)
  const activeCenterX = chevronSlots[activeIndex].x
    + Math.floor(chevronSlots[activeIndex].cx / 2)
  const columnCenters = slide.columns.map((_, index) =>
    majorSlots[index].x + Math.floor(majorSlots[index].cx / 2))
  const line = (transform: { x: number; y: number; cx: number; cy: number }) => {
    let connector = withElementId(linePrototype, takeShapeId())
    connector = withElementTransform(connector, transform)
    connectors.push(connector)
  }
  line({ x: activeCenterX, y: chevronBottom, cx: 0, cy: busY - chevronBottom })
  const busStart = Math.min(activeCenterX, ...columnCenters)
  const busEnd = Math.max(activeCenterX, ...columnCenters)
  if (busEnd > busStart) line({ x: busStart, y: busY, cx: busEnd - busStart, cy: 0 })
  columnCenters.forEach((centerX, index) => {
    line({ x: centerX, y: busY, cx: 0, cy: majorSlots[index].y - busY })
  })

  // 열별 Sub 박스 + 스파인.
  slide.columns.forEach((column, index) => {
    const baseX = majorSlots[index].x + subOffsetX
    column.subs.forEach((sub, row) => {
      let shape = withElementId(subPrototype, takeShapeId())
      shape = withElementTransform(shape, {
        x: baseX,
        y: subBase.y + subPitch * row,
        cx: subBase.cx,
        cy: subBase.cy,
      })
      shape = setShapeElementText(shape, sub, true)
      shapes.push(shape)
    })
    if (column.subs.length) {
      const lastSubBottom = subBase.y + subPitch * (column.subs.length - 1) + subBase.cy
      line({
        x: columnCenters[index],
        y: spineTop,
        cx: 0,
        cy: Math.max(0, lastSubBottom - spineTop),
      })
    }
  })

  return appendShapeTreeElements(xml, [...connectors, ...shapes])
}

const DEFINITION_TITLE_ID = '146'
const DEFINITION_HEADLINE_ID = '145'
const DEFINITION_TAG_ID = '100'
const DEFINITION_MEGA_BOX_ID = '52'
const DEFINITION_MEGA_TEXT_ID = '49'
const DEFINITION_NAME_IDS = ['48', '56', '58', '60'] as const
const DEFINITION_TEXT_IDS = ['50', '57', '59', '61'] as const
const DEFINITION_CONNECTOR_IDS = ['65', '66', '67', '68'] as const

/** 템플릿 6번 슬라이드의 4행을 채우고 남는 행 도형·커넥터를 지운다(7번은 미사용). */
export function renderProcessDefinitionSlide(
  sourceXml: string,
  slide: IssueAnalysisDeckProcessDefinitionSlide,
  plan: IssueAnalysisDeckPlan,
  outputPage: number,
): string {
  if (slide.rows.length < 1 || slide.rows.length > DEFINITION_NAME_IDS.length) {
    throw new Error('[issue-analysis] 프로세스 정의 행 수가 올바르지 않습니다.')
  }
  let xml = setPageFooter(sourceXml, outputPage, plan.meta.authorName)
  xml = setShapeText(
    xml,
    DEFINITION_TITLE_ID,
    `As-Is 프로세스 체계 – ${slide.megaCode}_${slide.megaName}${seriesSuffix(slide.pageInSeries, slide.pageCount)}`,
    true,
  )
  xml = setShapeText(xml, DEFINITION_TAG_ID, '2. 영역 별 이슈 및 원인 분석서')
  xml = setShapeText(xml, DEFINITION_HEADLINE_ID, slide.headline, true)
  xml = setShapeText(xml, DEFINITION_MEGA_BOX_ID, `${slide.megaCode}. ${slide.megaName}`, true)
  xml = setShapeText(xml, DEFINITION_MEGA_TEXT_ID, slide.megaDefinition, true)
  slide.rows.forEach((row, index) => {
    xml = setShapeText(xml, DEFINITION_NAME_IDS[index], `${row.seqLabel} ${row.name}`, true)
    xml = setShapeText(xml, DEFINITION_TEXT_IDS[index], row.definition, true)
  })
  for (let index = slide.rows.length; index < DEFINITION_NAME_IDS.length; index += 1) {
    xml = deleteShapeOrConnector(xml, DEFINITION_NAME_IDS[index])
    xml = deleteShapeOrConnector(xml, DEFINITION_TEXT_IDS[index])
    xml = deleteShapeOrConnector(xml, DEFINITION_CONNECTOR_IDS[index])
  }
  return xml
}
```

`jszipRenderer.ts` 수정 4곳:

```ts
import {
  renderProcessDefinitionSlide,
  renderProcessTreeSlide,
} from './processSlideRenderer'
import {
  ISSUE_ANALYSIS_DEFINITION_ROW_CAPACITY,
  ISSUE_ANALYSIS_TREE_COLUMN_CAPACITY,
  ISSUE_ANALYSIS_TREE_SUB_CAPACITY,
} from './processPages'

// renderSlide switch:
    case 'process-tree':
      xml = renderProcessTreeSlide(sourceXml, slide, plan, outputPage)
      break
    case 'process-definition':
      xml = renderProcessDefinitionSlide(sourceXml, slide, plan, outputPage)
      break

// expectedSourceSlide:
    case 'process-tree': return 5
    case 'process-definition': return 6

// validatePlan (forEach 내부에 추가):
    if (slide.kind === 'process-tree') {
      if (
        !slide.columns.length
        || slide.columns.length > ISSUE_ANALYSIS_TREE_COLUMN_CAPACITY
        || slide.pageInSeries < 1
        || slide.pageInSeries > slide.pageCount
        || !slide.headline
        || slide.columns.some(column =>
          !column.label
          || column.subs.length > ISSUE_ANALYSIS_TREE_SUB_CAPACITY
          || column.subs.some(sub => !sub))
      ) {
        throw new Error(
          `[issue-analysis] 출력 ${index + 1}페이지의 프로세스 트리 배치가 올바르지 않습니다.`,
        )
      }
    }
    if (slide.kind === 'process-definition') {
      if (
        !slide.rows.length
        || slide.rows.length > ISSUE_ANALYSIS_DEFINITION_ROW_CAPACITY
        || !slide.megaDefinition
        || !slide.headline
        || slide.pageInSeries < 1
        || slide.pageInSeries > slide.pageCount
        || slide.rows.some(row => !row.seqLabel || !row.name || !row.definition)
      ) {
        throw new Error(
          `[issue-analysis] 출력 ${index + 1}페이지의 프로세스 정의 배치가 올바르지 않습니다.`,
        )
      }
    }

// slideMetadataTitle:
    case 'process-tree':
      return `As-Is 프로세스 체계 – ${slide.megaCode}_${slide.megaName}`
    case 'process-definition':
      return `As-Is 프로세스 정의 – ${slide.megaCode}_${slide.megaName}`
```

- [ ] **Step 4: 통과 + 회귀** — Run: `npx vitest run tests/report/issue-analysis-process-render.test.ts tests/report/issue-analysis-export.test.ts` / Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/issues/processSlideRenderer.ts src/lib/report/issues/jszipRenderer.ts tests/report/issue-analysis-process-render.test.ts
git commit -m "feat(issues-ppt): 트리·정의 슬라이드 렌더러 — 템플릿 지오메트리 재사용

새로 그리지 않고 표준 템플릿 5·6번의 좌표를 프로토타입으로 복제한다.
체브론 부채꼴 커넥터는 활성 Mega가 영역마다 달라 직선 버스 배관으로
대체(재계산 불가 지오메트리 회피). 초과분 삭제·복제는 검증 실패 시
명시적 throw로 잘못된 공식 산출물을 만들지 않는다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 모달 Major 미지정 안내 + i18n

**Files:**
- Modify: `src/components/issues/IssueAnalysisModal.tsx`, `src/lib/i18n/dict/issues.ts`
- Test: `tests/ui/issue-analysis-modal.test.tsx`

- [ ] **Step 1: 실패 테스트 추가** — 기존 모달 테스트의 렌더 헬퍼로:

```ts
  it('Major 미지정 이슈가 있으면 (미지정) 안내를 보여준다', () => {
    // issues 픽스처 중 1건을 megaCode '02' + majorId: null 로 구성해 렌더
    expect(screen.getByText(/미지정/)).toBeInTheDocument()
  })
  it('전부 Major가 지정되면 안내가 없다', () => {
    expect(screen.queryByText(/\(미지정\)/)).toBeNull()
  })
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ui/issue-analysis-modal.test.tsx` / Expected: FAIL

- [ ] **Step 3: 구현** — 딕셔너리(`src/lib/i18n/dict/issues.ts`, `issue.analysis.preflightOk` 항목 옆에 ko/en 각각):

```ts
  'issue.analysis.majorUnsetNotice':
    "Major 미지정 이슈 {n}건은 PPT 프로세스 체계 트리에 '(미지정)'으로 표시됩니다. 이슈에서 Major를 지정하면 정의 페이지에도 포함됩니다.",
// en:
  'issue.analysis.majorUnsetNotice':
    "{n} issue(s) without a Major Process appear under '(미지정)' in the As-Is tree page. Assign a Major to include them in the definition pages.",
```

모달 — `preflight` 계산 옆에:

```tsx
  const majorUnsetCount = useMemo(
    () => scopedIssues.filter(issue => issue.megaCode && !issue.majorId).length,
    [scopedIssues],
  )
```

preflight OK/blocked 블록 아래(에러 블록 위)에:

```tsx
        {majorUnsetCount > 0 && (
          <div className="flex items-start gap-2 rounded-2xl border border-pending/35 bg-pending-weak p-4 text-xs leading-5 text-pending">
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
            {t('issue.analysis.majorUnsetNotice').replace('{n}', String(majorUnsetCount))}
          </div>
        )}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/ui/issue-analysis-modal.test.tsx` / Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/issues/IssueAnalysisModal.tsx src/lib/i18n/dict/issues.ts tests/ui/issue-analysis-modal.test.tsx
git commit -m "feat(issues): 분석 모달에 Major 미지정 안내 — 차단 없이 표시 규칙만 예고

레거시(0062 이전) 이슈는 트리에 (미지정)으로 나가는데, 사용자가 다운로드
후에야 아는 것보다 생성 전에 알려 분류를 유도한다. preflight 차단 조건은
바꾸지 않는다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 전체 검증 → 시각 확인 → 배포

**Files:** 없음(검증·수정만). 시각 확인 스크립트는 스크래치패드에 생성.

- [ ] **Step 1: 전체 테스트 + 린트** — Run: `npm run test` → 전체 PASS, `npm run lint` → 클린. 실패 시 해당 태스크 파일에서 수정 후 재실행.

- [ ] **Step 2: 시각 확인(스펙의 "구현 때 눈으로 확정" 게이트)** — 스크래치패드에 원샷 스크립트를 만들어 실행한다. 픽스처는 경계를 모두 포함: Major 8개(열 꽉 참)·Sub 6개 열·(계속) 열·(미지정) 열·정의 4+1행·활성 Mega가 '05'인 영역(체브론 강조 이동 확인).

```bash
# scratchpad/render-preview.mjs — tsx로 renderIssueAnalysisPptFromTemplate 호출해
# preview.pptx 생성 (프로젝트의 vitest 픽스처를 재사용해 plan 구성)
npx tsx <scratchpad>/render-preview.mjs
soffice --headless --convert-to pdf <scratchpad>/preview.pptx --outdir <scratchpad>
```

PDF를 Read 도구로 열어 확인: ① Sub 6칸이 푸터를 침범하지 않는가(침범 시 `ISSUE_ANALYSIS_TREE_SUB_CAPACITY`를 5로 낮추고 관련 테스트 기대값 갱신 — 상수 한 곳), ② 배관 선이 박스와 자연스럽게 만나는가, ③ 활성 체브론 강조가 올바른 Mega에 있는가, ④ 정의 페이지 빈 행 삭제가 깨끗한가. 문제가 있으면 상수/지오메트리를 수정하고 커밋(`fix(issues-ppt): …`).

- [ ] **Step 3: push (1회)** — Run:

```bash
git push origin main
```

pre-push 훅 통과 확인(G1: 마이그레이션 없음, G2: UI 위험 파일 없음).

- [ ] **Step 4: 프로덕션 검증** — Vercel 배포 완료 대기 후:

```bash
npm run smoke:prod
```

이후 사용자 흐름 안내: 이슈 목록 → 이슈분석서 모달 → 생성(프롬프트 v3라 캐시 1회 재생성으로 평소보다 느림 — 예상된 동작) → PPT 다운로드 → 5·6·7 상당 페이지 눈 확인. 화면 확인이 끝나면 `npm run mark:good`.

---

## Self-Review 결과 (계획 작성 시 수행)

- 스펙 커버리지: §3 데이터(Task 2·5), §3.1 스키마(Task 2·3), §4 AI(Task 4·5), §5 덱 플랜(Task 6), §6 렌더러(Task 1·7), §7 UI(Task 8), §8 테스트(각 태스크), §9 배포(Task 9). 공백 없음.
- 스펙 편차 1건(정의 슬라이드 headline)은 Global Constraints에 명시하고 Task 6에서 스펙 문서를 함께 갱신.
- 타입 일관성: `IssueAnalysisMajorProcess`(로더·스냅샷 입력) vs `IssueAnalysisAreaMajor`(영역 내부) 구분, `buildIssueAnalysisProcessSlides`·`renderProcessTreeSlide`·`renderProcessDefinitionSlide`·`parseIssueAnalysisAreaGeneration` 시그니처를 태스크 간 동일 표기로 통일함.
