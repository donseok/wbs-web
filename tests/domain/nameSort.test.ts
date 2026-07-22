import { describe, it, expect } from 'vitest'
import { compareKoreanName, sortByKoreanName } from '@/lib/domain/nameSort'

describe('compareKoreanName', () => {
  it('한글 이름을 가나다순으로 정렬한다', () => {
    const names = ['최지훈', '김철수', '박영희', '이민수', '홍길동']
    expect([...names].sort(compareKoreanName)).toEqual(['김철수', '박영희', '이민수', '최지훈', '홍길동'])
  })

  it('초성이 같으면 중성·종성까지 사전순으로 본다', () => {
    const names = ['김하늘', '김가영', '김나래', '김다솜']
    expect([...names].sort(compareKoreanName)).toEqual(['김가영', '김나래', '김다솜', '김하늘'])
  })

  it('성이 같고 이름 길이가 다르면 짧은 쪽이 앞선다', () => {
    expect([...['김철수', '김철']].sort(compareKoreanName)).toEqual(['김철', '김철수'])
  })

  it('이름 뒤 숫자는 수치로 비교한다(동명이인 번호)', () => {
    const names = ['홍길동10', '홍길동2', '홍길동1']
    expect([...names].sort(compareKoreanName)).toEqual(['홍길동1', '홍길동2', '홍길동10'])
  })

  it('빈 이름·null 은 항상 뒤로 보낸다', () => {
    const names = ['', '홍길동', null, '김철수']
    expect([...names].sort(compareKoreanName)).toEqual(['김철수', '홍길동', '', null])
  })

  // Array.prototype.sort 는 undefined 를 비교자에 넘기지 않고 무조건 끝에 둔다(명세).
  // 즉 sort 결과만 보는 단언은 undefined 처리를 전혀 검증하지 못한다.
  // 실제 호출부는 undefined 를 직접 넘기므로(AttendanceView 의 memberMap.get(id)?.name 등) 직접 호출로 확인한다.
  it('undefined 를 직접 넘겨도 뒤로 보낸다', () => {
    expect(compareKoreanName(undefined, '김철수')).toBe(1)
    expect(compareKoreanName('김철수', undefined)).toBe(-1)
    expect(compareKoreanName(undefined, undefined)).toBe(0)
    expect(compareKoreanName(null, undefined)).toBe(0)
  })

  it('앞뒤 공백은 무시한다', () => {
    expect(compareKoreanName(' 김철수 ', '김철수')).toBe(0)
    expect([...['  홍길동', '김철수']].sort(compareKoreanName)).toEqual(['김철수', '  홍길동'])
  })

  it('영문 이름끼리도 안정적으로 정렬한다', () => {
    expect([...['Charlie', 'alice', 'Bob']].sort(compareKoreanName)).toEqual(['alice', 'Bob', 'Charlie'])
  })

  it('한글과 영문이 섞여도 결과가 결정적이다', () => {
    const a = ['홍길동', 'Alice', '김철수', 'bob']
    const once = [...a].sort(compareKoreanName)
    const twice = [...a].reverse().sort(compareKoreanName)
    expect(once).toEqual(twice)
  })

  // 이 단언이 이 파일의 존재 이유다 — 'ko-KR' 고정이 풀리면(로케일 인자 삭제, 런타임 ko 데이터 누락 등)
  // 한글과 라틴 문자의 앞뒤가 통째로 뒤집힌다. en-US 는 ['Alice','bob','김철수','홍길동'] 을 낸다.
  // 위의 '결정적이다' 테스트는 순서가 뒤집혀도 통과하므로 이 케이스를 잡지 못한다.
  it('한글이 라틴 문자보다 앞선다(ko-KR 고정 확인 — en-US 면 정반대)', () => {
    expect([...['홍길동', 'Alice', '김철수', 'bob']].sort(compareKoreanName))
      .toEqual(['김철수', '홍길동', 'Alice', 'bob'])
    expect(compareKoreanName('홍길동', 'Alice')).toBeLessThan(0)
  })

  // numeric:true 의 부작용 — 앞자리 0 이 붙은 숫자 접미사는 동률이 된다.
  // 정렬용으로는 무해하지만(안정 정렬이 입력 순서를 지킨다) 동일성 판정으로 쓰면 틀린다.
  it('앞자리 0 이 붙은 숫자 접미사는 동률이다 — 동일성 판정에 쓰면 안 된다', () => {
    expect(compareKoreanName('홍길동01', '홍길동1')).toBe(0)
  })
})

describe('sortByKoreanName', () => {
  it('이름 필드를 기준으로 정렬한다', () => {
    const members = [{ name: '홍길동' }, { name: '김철수' }, { name: '박영희' }]
    expect(sortByKoreanName(members, m => m.name).map(m => m.name))
      .toEqual(['김철수', '박영희', '홍길동'])
  })

  it('입력 배열을 변형하지 않는다', () => {
    const members = [{ name: '홍길동' }, { name: '김철수' }]
    const sorted = sortByKoreanName(members, m => m.name)
    expect(members.map(m => m.name)).toEqual(['홍길동', '김철수'])
    expect(sorted).not.toBe(members)
  })

  it('이름이 없는 항목을 뒤로 보내고 나머지 순서를 지킨다', () => {
    const rows = [{ name: null }, { name: '홍길동' }, { name: '' }, { name: '김철수' }]
    expect(sortByKoreanName(rows, r => r.name).map(r => r.name))
      .toEqual(['김철수', '홍길동', null, ''])
  })
})
