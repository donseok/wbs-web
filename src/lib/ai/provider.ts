// ============================================================================
// 제공자 비종속(provider-agnostic) AI 설정.
// 기본값 = Google Gemini 무료 티어. 키가 없으면 hasLLM/hasEmbeddings 가 false →
// 호출측이 결정형(deterministic) 경로로 자동 폴백한다.
// AI_PROVIDER=openai 로 두면 OpenAI 호환 엔드포인트(Groq/OpenRouter/사내 LLM 등)로 전환.
// ============================================================================

export type AiProvider = 'gemini' | 'openai'

export function aiProvider(): AiProvider {
  return process.env.AI_PROVIDER === 'openai' ? 'openai' : 'gemini'
}

export interface LlmConfig {
  provider: AiProvider
  apiKey?: string
  baseUrl: string
  model: string
}

export function llmConfig(): LlmConfig {
  if (aiProvider() === 'openai') {
    return {
      provider: 'openai',
      apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
      baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
    }
  }
  return {
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    // gemini-3.5-flash = 현행 최신 안정판(2026-05 출시) + 무료 티어 지원(2026-07-02 실 키로 200 확인).
    // 구 기본값 gemini-2.5-flash 는 2026-10-16 셧다운 확정(공식 deprecations) — 오버라이드로도 잔류 금지.
    // gemini-2.0-flash 는 2026-06-01 완전 종료, Pro 계열(2.5-pro/3.x-pro)은 무료 쿼터 0(매 호출 429).
    // (gemini-flash-latest 별칭도 현재 3.5-flash 를 가리킴. GEMINI_MODEL 로 오버라이드)
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  }
}

export interface EmbedConfig extends LlmConfig {
  dim: number
}

export function embedConfig(): EmbedConfig {
  if (aiProvider() === 'openai') {
    return {
      provider: 'openai',
      apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
      baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.EMBED_MODEL || 'text-embedding-3-small',
      // 마이그레이션 vector(768)에 맞추기 위해 768로 고정(text-embedding-3-* 는 dimensions 파라미터로 축소 지원).
      // EMBED_DIM 으로 오버라이드 가능하나, 변경 시 마이그레이션 차원도 함께 맞출 것.
      dim: Number(process.env.EMBED_DIM) || 768,
    }
  }
  return {
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    // gemini-embedding-001 = 현행 GA 임베딩 모델(text-embedding-004 후속). 기본 3072차원 →
    // outputDimensionality 로 768 로 축소(마이그레이션 vector(768) 및 pgvector HNSW 2000차원 한계에 맞춤).
    model: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
    dim: Number(process.env.EMBED_DIM) || 768,
  }
}

/** LLM 답변 생성 키가 설정돼 있는가. false 면 결정형 답변으로 폴백. */
export function hasLLM(): boolean {
  return !!llmConfig().apiKey
}

/** 임베딩(의미검색) 키가 설정돼 있는가. false 면 구조화 질의만 사용. */
export function hasEmbeddings(): boolean {
  return !!embedConfig().apiKey
}
