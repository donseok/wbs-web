/**
 * wbs_items.spec 갱신 시 change_logs.new_value 에 저장하는 로케일 중립 토큰(Task 12A 결정 B).
 * 리터럴 한국어 문자열을 그대로 저장하면 en 사용자 이력에도 그대로 노출된다(리뷰 라운드 1).
 * 서버 액션(wbsSpec.ts)이 이 토큰을 기록하고, 렌더 경로(RowDetailPanel.fmtValue)가 사전 키로
 * 변환해 표시한다 — 'use server' 파일은 async 함수 외의 export 를 허용하지 않아(Next.js 제약)
 * 상수를 별도 순수 모듈로 뺐다.
 */
export const SPEC_UPDATED_TOKEN = 'spec:updated'
