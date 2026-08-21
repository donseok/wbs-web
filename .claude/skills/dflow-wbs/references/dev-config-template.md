# Dev Config 템플릿

`skills/wbs/SKILL.md`가 WBS 생성 시 헤더 블록과 첫 번째 WP 사이에 삽입하는 `## Dev Config` 섹션의 **단일 공식 템플릿**. TRD의 기술 스택 정보를 참조하여 값을 채우고, 추론할 수 없는 항목은 사용자에게 확인한다.

> 본 파일은 `scripts/wbs-parse.py`가 `DEV_CONFIG_MISSING` 에러 메시지를 생성할 때 **동적으로 읽어들이는 원본**이다. 아래 ```markdown 펜스 블록 안의 내용이 템플릿 본문이며, Python 코드 내 하드코딩 복사본은 파일 읽기에 실패한 경우의 fallback이다.

- `fullstack` domain은 unit/e2e 명령이 있는 모든 domain을 순차 실행 (fail-fast)
- `-` = 해당 테스트 N/A (해당 domain에는 그 유형의 테스트가 없음)
- `Quality Commands`는 Build/Refactor 단계에서 참조 — `lint`/`typecheck`/`coverage` 명령을 정의. 값이 `-`이면 생략
- `Cleanup Processes`는 테스트 실행 후 정리할 프로세스 이름(node, vitest 등). Dev Config 로딩 단에서 `run-test.py`가 사용한다

```markdown
## Dev Config

### Domains
| domain | description | unit-test | e2e-test | e2e-server | e2e-url |
|--------|-------------|-----------|----------|------------|---------|
| backend | Server API | `your-unit-test-cmd` | `your-e2e-test-cmd` | - | - |
| frontend | Client UI | `your-unit-test-cmd` | `your-e2e-test-cmd` | `your-dev-server-cmd` | `http://localhost:3000` |
| database | Data layer | - | - | - | - |
| fullstack | Full stack | - | - | - | - |

### Design Guidance
| domain | architecture |
|--------|-------------|
| backend | Your backend architecture description |
| frontend | Your frontend architecture description. 라우팅과 메뉴 연결: 신규 페이지는 즉시 라우터에 등록하고 메뉴/사이드바의 진입점을 같은 Task에서 추가한다. 라우터·메뉴 배선을 분리된 후속 Task로 미루면 orphan page가 발생한다. |

### Quality Commands
| name | command |
|------|---------|
| lint | `your-lint-cmd` |
| typecheck | `your-typecheck-cmd` |
| coverage | `your-coverage-cmd` |

### Cleanup Processes
node, vitest
```
