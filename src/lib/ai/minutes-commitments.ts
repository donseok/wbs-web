import type { TeamCode } from '@/lib/domain/types'
import {
  fnv1a64,
  isMarkableBlock,
  type MinuteBlock,
} from '@/lib/minutes/blocks'

export interface ParsedCommitment {
  i: number
  commitmentText: string
  sourceQuote: string
  ownerName: string | null
  ownerTeam: TeamCode | null
  dueText: string | null
  dueDate: string | null
  commitmentHash: string
}

const TEAM_CODES: readonly TeamCode[] = ['PMO', 'ERP', 'MES', '가공']
const ITEM_CAP = 30
const RAW_CAP = 200_000
const COMMITMENT_TEXT_CAP = 240
const SOURCE_QUOTE_CAP = 500
const OWNER_NAME_CAP = 100
const DUE_TEXT_CAP = 120
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const UNSAFE_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizedString(value: unknown, cap: number): string | null {
  if (typeof value !== 'string' || UNSAFE_CONTROL_RE.test(value)) return null
  const normalized = normalizeText(value)
  if (!normalized || normalized.length > cap) return null
  return normalized
}

function groundedString(value: unknown, blockText: string, cap: number): string | null {
  const normalized = normalizedString(value, cap)
  return normalized && blockText.includes(normalized) ? normalized : null
}

/** YYYY-MM-DD 형식과 실제 Gregorian 달력 날짜를 모두 검증한다. */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false

  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

function parsedDueDate(value: unknown, groundedDueText: string | null): string | null {
  if (!groundedDueText || typeof value !== 'string') return null
  const candidate = value.trim()
  return isValidIsoDate(candidate) ? candidate : null
}

function parsedTeam(value: unknown, blockText: string): TeamCode | null {
  if (typeof value !== 'string') return null
  const candidate = normalizeText(value) as TeamCode
  return TEAM_CODES.includes(candidate) && blockText.includes(candidate) ? candidate : null
}

function hashCommitment(
  i: number,
  blockHash: string,
  fields: Omit<ParsedCommitment, 'i' | 'commitmentHash'>,
): string {
  return fnv1a64(JSON.stringify([
    'minute-commitment-v1',
    i,
    blockHash,
    fields.commitmentText,
    fields.sourceQuote,
    fields.ownerName,
    fields.ownerTeam,
    fields.dueText,
    fields.dueDate,
  ]))
}

/** 본문과 회의일 중 하나라도 바뀌면 다른 추출 컨텍스트가 되도록 timezone·버전과 함께 해시한다. */
export function commitmentContextHash(bodyMd: string, minuteDate: string): string {
  return fnv1a64(JSON.stringify(['minute-commitment-context-v1', 'Asia/Seoul', minuteDate, bodyMd]))
}

/**
 * LLM JSON 응답을 관용적으로 파싱하되, 원문으로 검증할 수 있는 약속만 반환한다.
 * - 필수 근거인 sourceQuote가 현재 블록 본문에 없으면 항목 전체를 버린다.
 * - owner/team/dueText는 근거가 없으면 값을 추측하지 않고 null로 내린다.
 * - dueDate는 근거 dueText가 있고 실제 ISO 날짜일 때만 유지한다.
 */
export function parseCommitmentItems(
  raw: string,
  blocks: MinuteBlock[],
  minuteDate: string,
): ParsedCommitment[] | null {
  if (!isValidIsoDate(minuteDate) || raw.length > RAW_CAP) return null
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  const seen = new Set<string>()
  const out: ParsedCommitment[] = []
  for (const candidate of parsed) {
    if (out.length >= ITEM_CAP) break
    if (typeof candidate !== 'object' || candidate === null) continue
    const item = candidate as Record<string, unknown>
    const i = item.i
    if (typeof i !== 'number' || !Number.isInteger(i)) continue

    const block = blocks[i]
    if (!block || !isMarkableBlock(block)) continue
    // 생성 프롬프트의 짧은 키(commitment)와 도메인 API 키(commitmentText)를 모두 수용한다.
    const commitmentText = normalizedString(
      item.commitmentText ?? item.commitment,
      COMMITMENT_TEXT_CAP,
    )
    const sourceQuote = normalizedString(item.sourceQuote, SOURCE_QUOTE_CAP)
    if (!commitmentText || !sourceQuote || !block.text.includes(sourceQuote)) continue

    const ownerName = groundedString(item.ownerName, block.text, OWNER_NAME_CAP)
    const ownerTeam = parsedTeam(item.ownerTeam, block.text)
    const dueText = groundedString(item.dueText, block.text, DUE_TEXT_CAP)
    const dueDate = parsedDueDate(item.dueDate, dueText)
    const fields = { commitmentText, sourceQuote, ownerName, ownerTeam, dueText, dueDate }
    const commitmentHash = hashCommitment(i, block.hash, fields)
    if (seen.has(commitmentHash)) continue
    seen.add(commitmentHash)
    out.push({ i, ...fields, commitmentHash })
  }
  return out
}
