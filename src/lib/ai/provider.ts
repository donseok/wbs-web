// ============================================================================
// 제공자 비종속(provider-agnostic) AI 설정.
// 기본값 = Google Gemini 무료 티어. 키가 없으면 hasLLM/hasEmbeddings 가 false →
// 호출측이 결정형(deterministic) 경로로 자동 폴백한다.
// AI_PROVIDER=openai 로 두면 OpenAI 호환 엔드포인트(Groq/OpenRouter/사내 LLM 등)로 전환.
//
// 텍스트 생성 LLM 에 한해, 관리 화면(/admin/llm-config)에서 저장한 서버 전역 설정이
// env 보다 우선한다(llm-override.ts 캐시). 임베딩은 env 전용 그대로다.
// ============================================================================

import { llmOverrideSync } from './llm-override'
import { DEFAULT_GEMINI_BASE_URL, DEFAULT_OPENAI_BASE_URL } from './endpoints'

export type AiProvider = 'gemini' | 'openai'

export function aiProvider(): AiProvider {
  return process.env.AI_PROVIDER === 'openai' ? 'openai' : 'gemini'
}

export interface LlmConfig {
  provider: AiProvider
  apiKey?: string
  baseUrl: string
  model: string
  /** 프로필의 '최대 출력 토큰'. env 모드에는 없다(미지정이면 llm.ts 의 기본값 사용). */
  maxOutputTokens?: number
}

function envLlmConfig(): LlmConfig {
  if (aiProvider() === 'openai') {
    return {
      provider: 'openai',
      apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
      baseUrl: process.env.LLM_BASE_URL || DEFAULT_OPENAI_BASE_URL,
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
    }
  }
  return {
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    baseUrl: process.env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL,
    // gemini-3.5-flash = 현행 최신 안정판(2026-05 출시) + 무료 티어 지원(2026-07-02 실 키로 200 확인).
    // 구 기본값 gemini-2.5-flash 는 2026-10-16 셧다운 확정(공식 deprecations) — 오버라이드로도 잔류 금지.
    // gemini-2.0-flash 는 2026-06-01 완전 종료, Pro 계열(2.5-pro/3.x-pro)은 무료 쿼터 0(매 호출 429).
    // (gemini-flash-latest 별칭도 현재 3.5-flash 를 가리킴. GEMINI_MODEL 로 오버라이드)
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  }
}

export function llmConfig(): LlmConfig {
  const ov = llmOverrideSync()
  // 활성 프로필이 선택돼 있으면 provider 까지 프로필 값을 따른다(env 의 AI_PROVIDER 무시).
  if (ov.mode === 'profile' && ov.profile) {
    return { ...ov.profile }
  }
  // '선택 안함' = 키 미설정과 동일하게 취급 — 소비처의 기존 폴백 경로가 그대로 동작한다.
  if (ov.mode === 'none') {
    return { ...envLlmConfig(), apiKey: undefined }
  }
  return envLlmConfig()
}

export interface EmbedConfig extends LlmConfig {
  dim: number
}

export function embedConfig(): EmbedConfig {
  if (aiProvider() === 'openai') {
    return {
      provider: 'openai',
      apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
      baseUrl: process.env.LLM_BASE_URL || DEFAULT_OPENAI_BASE_URL,
      model: process.env.EMBED_MODEL || 'text-embedding-3-small',
      // 마이그레이션 vector(768)에 맞추기 위해 768로 고정(text-embedding-3-* 는 dimensions 파라미터로 축소 지원).
      // EMBED_DIM 으로 오버라이드 가능하나, 변경 시 마이그레이션 차원도 함께 맞출 것.
      dim: Number(process.env.EMBED_DIM) || 768,
    }
  }
  return {
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    baseUrl: process.env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL,
    // gemini-embedding-001 = 현행 GA 임베딩 모델(text-embedding-004 후속). 기본 3072차원 →
    // outputDimensionality 로 768 로 축소(마이그레이션 vector(768) 및 pgvector HNSW 2000차원 한계에 맞춤).
    model: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
    dim: Number(process.env.EMBED_DIM) || 768,
  }
}

/** LLM 답변 생성 키가 설정돼 있는가. false 면 결정형 답변으로 폴백. */
export function hasLLM(): boolean {
  // '선택 안함'은 env 에 키가 있어도 차단. 프로필/env 모드는 llmConfig() 가 이미 오버라이드를
  // 반영한 값을 주므로(openai 프로필은 placeholder 키까지 보장) 키 유무만 보면 된다.
  if (llmOverrideSync().mode === 'none') return false
  return !!llmConfig().apiKey
}

/** 임베딩(의미검색) 키가 설정돼 있는가. false 면 구조화 질의만 사용. */
export function hasEmbeddings(): boolean {
  return !!embedConfig().apiKey
}
