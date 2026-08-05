# 23 — 맥미니 자체 호스팅 절차서 (설계자 C · 3라운드)

작성 2026-08-05 · 설계자 C · 대상: `05-pm-brief-selfhost.md` §4 Q-B / §5 설계자 C 임무
선행: `03-platform-port.md`(이식 계획) · `13-baseline-measurements.md`(실측)

> **이 문서는 절차서다. 이 세션에서는 한 줄도 실행하지 않았다.**
> 아래 명령은 전부 "맥미니에서 운영자가 칠 것"이며, 설치·빌드·배포는 안전 제약으로 금지돼 있다.
> 실행하지 않은 명령을 "확인했다"고 쓰지 않는다 — 검증 상태는 각 절의 ⚠️ 표시로 구분한다.

---

## 1. 요약

1. **부족한 자원은 디스크가 아니라 RAM이다.** RAM 16GB 확정 기준으로 상주 6.0 GB·가용 10.0 GB이며, 이것이 **동시 러너 3~4개 · 빌드 1개**로 처리량을 묶는다(§3.4). 반대로 **256GB 스토리지는 약 130 GiB가 남아 충분하다**(§9) — RAM이 동시 작업을 묶어 주기 때문에 디스크를 폭주시킬 작업 자체가 못 생긴다.
2. **에이전트 API를 공개 인터넷에서 완전히 제거한다.** 접속 주체가 러너로 확정됐으므로(사람은 조회·승인만), **러너·운영자는 Tailscale, 사람은 Cloudflare Tunnel**로 평면을 가른다. Caddy가 물리적으로 분리하고 공개 경로에서는 `/api/v1/agent/*`가 404다(§5.0, §5.2.1). 시크릿이 유출돼도 tailnet 밖에서는 도달조차 못 한다.
3. **포트포워딩은 기각.** 한국 가정용 회선은 인바운드 80/443 차단·CGNAT·약관상 서버 운영 제한이 겹쳐 있고, 터널은 아웃바운드 연결만 쓰므로 셋 중 앞의 둘을 우회한다. **다만 약관 문제는 우회하지 못한다**(§5.5).
4. **Tomcat의 실제 비용은 재작성 공수가 아니라 러너 처리량이다.** 16GB에서 JVM이 2.5 GB를 가져가면 **동시 러너가 3~4개에서 2개로 준다**(−25~50%). 디스크는 +6~11 GiB로 문제가 아니다. 기각하지 않는다 — 이 값을 내면 돈다(§4.2.1). 코드 재작성 견적은 설계자 B.
5. **macOS 고유 함정 셋이 무인 운영을 조용히 깨뜨린다** — FileVault(재부팅 후 디스크 잠김), `brew services`의 LaunchAgent(로그인 전 미기동), macOS 자동 업데이트 재부팅. 셋 다 §8에서 명령으로 해제한다. 그리고 디스크 풀 방어(캡·밸러스트·2단 알람)를 1일차에 넣는다 — 2026-08-05 장애의 형태가 여기서 재현될 수 있다(§10).

---

## 2. 전제와 미확인

| 항목 | 상태 |
|---|---|
| 스토리지 256GB | 사용자 진술. 이 문서의 용량 산정 기준 |
| **RAM = 16GB** | **확정**(2026-08-05 사용자 답변). 종전 "256GB 메모리"는 오기였다. 이 문서는 **16GB 단일 전제**로 쓴다 — 다른 용량은 각주로만 남긴다 |
| 칩 | M4(사용자 진술) = arm64. Homebrew 경로 `/opt/homebrew` |
| **서버에 접속하는 주체** | **확정: 에이전트 러너만.** 사람은 WBS 조회와 승인만 한다(`05-pm-brief-selfhost.md` Q-A 해석 2). 이 확정이 §5 외부 노출 설계를 바꾼다 |
| macOS 버전 | 미확인. 이 문서의 명령은 최근 macOS(14~26) 공통 문법 기준 |
| 회선 종류·상향 대역·공인 IP 여부 | **미확인.** §5.5에서 측정 방법을 제시 |
| 맥미니가 전용 서버인가, 개발 겸용인가 | **미확인. 용량 설계를 뒤집는 변수다**(§9.4) |

### 2.1 RAM 16GB 확정이 바꾸는 것 — 병목이 디스크에서 RAM으로 옮겨간다

16GB 확정으로 이 문서의 무게중심이 이동한다.

- **디스크(256GB)는 오히려 여유가 생긴다.** 16GB RAM에서는 대형 로컬 LLM을 애초에 못 돌리므로(설계자 B 영역), §9에서 모델 파일에 잡았던 100 GiB 예산이 **15~20 GiB로 줄어든다.**
- **대신 RAM이 진짜 상한이 된다.** MariaDB·Node·러너·빌드가 16GB를 나눠 쓴다(§3.4 RAM 예산표).
- **그리고 RAM 부족은 다시 디스크를 먹는다.** macOS는 동적 스왑을 `/System/Volumes/Data`에 만든다. 16GB에서 `next build`(피크 2~4GB)와 MariaDB와 러너가 겹치면 스왑이 수 GiB~십수 GiB까지 자란다. **RAM 압박이 디스크 풀로 번지는 경로**이며, 2026-08-05 장애의 형태와 정확히 같다(§9.5).

**실측 참조값 — 이 문서의 용량 숫자는 현 개발기(MacBook Air M3, macOS 26.5.2, arm64)에서 잰 것이다.** 맥미니의 값이 아니라 **같은 도구를 깔면 얼마가 되는지의 근거**다.

| 측정 대상 | 실측값 | 조회 방법 |
|---|---|---|
| 시스템 볼륨(읽기전용 스냅샷) | 12 GiB | `df -h /` |
| Xcode Command Line Tools | **2.2 GiB** | `du -sh /Library/Developer/CommandLineTools` |
| Homebrew 전체(formula 91 + cask 5) | **5.8 GiB** | `du -sh /opt/homebrew` |
| Homebrew 다운로드 캐시 | 635 MiB | `du -sh ~/Library/Caches/Homebrew` |
| npm 캐시 | **5.1 GiB** | `du -sh ~/.npm` |
| 범용 캐시 `~/.cache` | **8.4 GiB** | `du -sh ~/.cache` |
| Playwright 브라우저 | 996 MiB | `du -sh ~/Library/Caches/ms-playwright` |
| wbs-web 리포 전체 | **1.8 GiB** | `du -sh .` |
| ├ `node_modules` | 729 MiB | `du -sh node_modules` |
| ├ `.next` | **1.0 GiB** | `du -sh .next` |
| └ `.git` | 26 MiB | `du -sh .git` |
| Java | **미설치**(`Unable to locate a Java Runtime`) | `java -version` |
| 현 DB 총량(Postgres) | **53 MB** | `pg_database_size` — `13-baseline-measurements.md` |
| 현 업로드 파일 총량 | **363 kB / 25객체** | 동 문서 §3 |

**이 표에서 곧바로 나오는 결론:** 디스크를 먹는 것은 **데이터가 아니라 도구와 캐시**다. DB 53MB·파일 363kB인데 npm 캐시 하나가 5.1GiB다. 용량 설계는 데이터 증가가 아니라 **캐시 증가**를 막는 설계여야 한다.

---

## 3. MariaDB 설치 · 초기 설정

### 3.1 버전 확인이 먼저다 ⚠️

벡터 검색(`VECTOR` 타입 + HNSW + `VEC_DISTANCE_COSINE`)은 **MariaDB 11.7 이상**에서만 있다. `04-pm-synthesis.md` P2가 허용한 것은 **11.8 LTS**다.

```bash
brew update
brew info mariadb          # Version 확인 — 11.8 이상인지
brew search mariadb        # mariadb@11.8 같은 버전 지정 formula 가 있는지
```

**⚠️ 확인하지 못한 것:** Homebrew에 `mariadb@11.8` 버전 formula가 존재하는지 이 세션에서 조회하지 않았다(설치·네트워크 조회 금지). `brew info mariadb`가 11.8 미만을 가리키면 **Homebrew를 쓰지 말고** MariaDB 공식 배포판(mariadb.org의 macOS tarball 또는 공식 리포지터리)으로 설치할 것. 버전이 낮으면 벡터 기능이 통째로 없다.

### 3.2 설치

```bash
# 사전: Homebrew 없으면 먼저 설치 (arm64 → /opt/homebrew)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

brew install mariadb        # (또는 brew install mariadb@11.8)
```

**아직 `brew services start` 하지 않는다.** 설정 파일을 먼저 놓는다 — 기본 설정으로 한 번 뜨면 잘못된 문자셋으로 시스템 테이블이 만들어질 수 있다.

### 3.3 설정 파일

`/opt/homebrew/etc/my.cnf.d/dflow.cnf` 를 새로 만든다(기존 `my.cnf`를 편집하지 말 것 — brew 업그레이드 때 덮인다).

```ini
[mysqld]
# ── 접근 ────────────────────────────────────────────────
# 앱이 같은 기계에 있으므로 외부에 절대 열지 않는다.
# 이것이 "RLS를 버려도 되는" 전제 중 하나다(03-platform-port.md §3.1).
bind-address              = 127.0.0.1
skip-name-resolve         = ON

# ── 문자셋 ──────────────────────────────────────────────
character-set-server      = utf8mb4
collation-server          = utf8mb4_uca1400_ai_ci   # MariaDB 11.x. 오류 나면 utf8mb4_unicode_ci

# ── 타임존: 전 구간 UTC. 03-platform-port.md R7 의 대응책 ──
# 이걸 빼면 근태·회의·주간보고 날짜가 하루씩 어긋난다.
default_time_zone         = '+00:00'

# ── 엄격 모드: 조용한 잘림을 금지한다 ─────────────────────
sql_mode = STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,NO_ZERO_DATE,NO_ZERO_IN_DATE

# ── 내구성: 가정용 전원은 언제든 끊긴다 ────────────────────
innodb_flush_log_at_trx_commit = 1
sync_binlog                    = 1

# ── 바이너리 로그(PITR) + 디스크 폭주 방지 ─────────────────
log_bin                   = /opt/homebrew/var/mysql-binlog/binlog
binlog_format             = ROW
max_binlog_size           = 128M
binlog_expire_logs_seconds = 604800        # 7일. 이 줄이 없으면 디스크가 조용히 찬다

# ── 메모리: RAM 16GB 확정값 기준(§3.4) ─────────────────────
# 현 데이터 총량이 53MB 다(13-baseline §2). 1G 는 이미 데이터의 20배다.
# 여기서 아낀 RAM 이 빌드·러너 몫이 된다 — 16GB 에서는 그게 더 값지다.
innodb_buffer_pool_size   = 1G
innodb_log_file_size      = 256M
max_connections           = 60             # 러너 수 + 앱 풀. 16GB 에서 100은 과하다

# ── 느린 쿼리 로그(크기 캡과 함께) ─────────────────────────
slow_query_log            = ON
slow_query_log_file       = /opt/homebrew/var/mysql-log/slow.log
long_query_time           = 1

# ── 에러 로그 ─────────────────────────────────────────────
log_error                 = /opt/homebrew/var/mysql-log/error.log

[client]
default-character-set     = utf8mb4
```

디렉터리를 미리 만든다:

```bash
mkdir -p /opt/homebrew/var/mysql-binlog /opt/homebrew/var/mysql-log
```

### 3.4 RAM 16GB 예산 — 무엇이 얼마를 먹는가

**RAM 16GB가 이 구성의 진짜 상한이다.** 각 상주 프로세스의 실사용을 잡아 본다.

| 프로세스 | 상주 RAM | 비고 |
|---|---|---|
| macOS 26 유휴 | 3.5 GB | GUI 로그인 상태 기준. 헤드리스라도 크게 줄지 않는다 |
| MariaDB (`buffer_pool 1G`) | 1.5 GB | 버퍼풀 + 커넥션·스레드 오버헤드 |
| Node 앱(Next standalone, production) | 0.8 GB | |
| Caddy + cloudflared + Tailscale | 0.2 GB | 셋 합쳐 |
| **상주 소계** | **약 6.0 GB** | |
| **가용 여유** | **약 10.0 GB** | 아래를 여기서 나눠 쓴다 |
| `next build` 1회 | **2~4 GB(피크)** | 동시 2개는 위험 |
| 에이전트 러너 1개(CLI + node) | 0.5~1.5 GB | |
| 로컬 LLM 7~8B Q4 | 5~7 GB | 돌리면 빌드와 공존 불가 (설계자 B 영역) |

**여기서 나오는 운영 규칙 셋:**

1. **빌드는 동시 1개.** 러너가 여러 개 붙어도 빌드 큐는 직렬화한다(설계자 B의 품질 게이트 큐와 같은 축).
2. **러너 동시 실행은 3~4개가 상한.** 러너 4개(최대 6 GB) + 빌드 1개(4 GB) = 10 GB로 여유를 정확히 채운다. 그 이상은 스왑으로 넘어간다.
3. **로컬 LLM을 켜면 빌드·러너 여유가 사라진다.** 16GB에서 이 셋은 공존하지 못한다 — 어느 것을 포기할지가 설계자 B의 판단 사항이다.

`innodb_buffer_pool_size = 1G`으로 낮춘 이유가 여기 있다. 데이터가 53MB인데 2G를 잡으면 **아무 이득 없이 러너 하나 몫의 RAM을 뺏는다.**

> 각주(참고용): RAM이 24/32/64GB였다면 buffer pool을 각각 2G/3G/4G까지 올릴 수 있고 러너 동시 실행 상한도 비례해 오른다. **16GB 확정이므로 본문에서는 다루지 않는다.**

**과대 설정 경계.** buffer pool을 키우면 macOS가 스왑을 쓰기 시작하고, 스왑 파일이 **디스크를 먹는다**(§2.1). RAM 절약이 곧 디스크 방어다.

### 3.5 기동 · 보안 초기화

```bash
sudo brew services start mariadb        # sudo 중요 — §8.2 참조
sleep 5
mariadb --version
mariadb -e "select @@version, @@character_set_server, @@collation_server, @@time_zone, @@sql_mode\G"
```

기대값: 버전 11.8+, `utf8mb4`, `+00:00`, `STRICT_TRANS_TABLES` 포함.

```bash
sudo mariadb-secure-installation
# - root 비밀번호 설정: Y
# - unix_socket 인증: Y (로컬 root 는 소켓 인증이 더 안전)
# - 익명 사용자 제거: Y
# - root 원격 로그인 금지: Y
# - test DB 제거: Y
# - 권한 테이블 리로드: Y
```

### 3.6 벡터 기능 실재 확인 (설치 직후 반드시)

```bash
mariadb -u root -p -e "
  create database if not exists _vectorcheck;
  use _vectorcheck;
  create table t (id int primary key, v vector(4) not null, vector index (v));
  insert into t values (1, vec_fromtext('[1,0,0,0]')), (2, vec_fromtext('[0,1,0,0]'));
  select id, vec_distance_cosine(v, vec_fromtext('[1,0,0,0]')) as d from t order by d limit 2;
  drop database _vectorcheck;
"
```

**⚠️ 이 쿼리는 실행하지 않았다.** 함수명·문법은 MariaDB 11.7+ 문서 기준이며, 실제 동작·정확한 시그니처는 맥미니에서 위 명령으로 **직접 확인해야 한다.** 실패하면 §3.1로 돌아가 버전을 다시 본다. 이것이 P2(MariaDB 허용) 결정의 유일한 실증 지점이다.

### 3.7 계정 — 최소권한 3종

`03-platform-port.md` §5.2의 설계를 그대로 명령으로 내린다. **RLS가 없으므로 DB 계정 분리가 남은 몇 안 되는 구조적 방어선이다.**

```sql
-- root 로 접속해서 실행
create database dflow character set utf8mb4 collate utf8mb4_uca1400_ai_ci;

-- 앱 런타임: DML 만. DDL 없음 → 앱 코드 결함이 스키마를 부수지 못한다
create user 'dflow_app'@'localhost' identified by '<앱-전용-강한-비밀번호>';
grant select, insert, update, delete on dflow.* to 'dflow_app'@'localhost';

-- 마이그레이션 전용: 배포 파이프라인만 사용
create user 'dflow_migrator'@'localhost' identified by '<마이그레이션-전용-비밀번호>';
grant all privileges on dflow.* to 'dflow_migrator'@'localhost';

-- 백업 전용
create user 'dflow_backup'@'localhost' identified by '<백업-전용-비밀번호>';
grant select, lock tables, show view, event, trigger, reload, replication client on *.* to 'dflow_backup'@'localhost';

flush privileges;
```

비밀번호는 **리포에 넣지 않는다.** `/opt/homebrew/etc/dflow/env`(퍼미션 600, root 소유)에 두고 앱 서비스가 읽는다.

```bash
sudo mkdir -p /opt/homebrew/etc/dflow
sudo touch /opt/homebrew/etc/dflow/env
sudo chmod 600 /opt/homebrew/etc/dflow/env
sudo chown root:wheel /opt/homebrew/etc/dflow/env
# 편집: DATABASE_URL=mysql://dflow_app:...@127.0.0.1:3306/dflow  등
```

---

## 4. 웹서버 — 두 갈래

### 4.0 공통: 리버스 프록시는 Caddy를 권고

nginx가 아니라 Caddy를 권고하는 이유 셋:
- TLS 자동 발급·갱신 내장(포트포워딩 경로를 택할 경우 certbot이 통째로 불필요)
- 설정 파일이 짧아 운영자 실수가 적다
- **Node와 Tomcat을 같은 앞단에서 경로별로 나눌 수 있다** — §4.3 점진 이관의 전제

```bash
brew install caddy
```

### 4.1 갈래 A — Node / Next.js (현 코드 그대로, 권고)

현 코드베이스는 TS 76,425줄·Next.js 15다(`03-platform-port.md` §4.1). 추가 설치물이 거의 없다.

```bash
brew install node@22          # 현 개발기 실측 v22.18.0 과 맞춘다
node -v && npm -v
```

배포 산출물은 Next standalone을 권고한다(`node_modules` 전체를 서버에 두지 않아 디스크를 아낀다).

`next.config.ts`에 `output: 'standalone'` 추가가 선행돼야 한다 — **⚠️ 현재 이 리포에는 없다**(실측: `next.config.ts`에 `outputFileTracingRoot`·`outputFileTracingIncludes`·`headers`만 있음). 이식 착수 시 추가할 항목으로 남긴다.

배포 디렉터리 규약:

```
/opt/dflow/
├── releases/
│   ├── 20260805-1200/        ← 빌드 산출물(standalone)
│   └── 20260805-1530/
├── current -> releases/20260805-1530     ← 심볼릭 링크 교체로 원자적 배포
├── files/                    ← Storage 대체(03-platform-port.md §3.3)
└── backups/
```

```bash
sudo mkdir -p /opt/dflow/{releases,files,backups}
sudo chown -R "$(whoami)":staff /opt/dflow
```

LaunchDaemon은 §8.3.

### 4.2 갈래 B — Tomcat (사용자 요청 경로)

```bash
brew install openjdk@21       # 또는 temurin
sudo ln -sfn /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk \
             /Library/Java/JavaVirtualMachines/openjdk-21.jdk
java -version                 # 현 개발기에는 Java 가 아예 없다(실측)

brew install tomcat
# 기본 경로(예): /opt/homebrew/opt/tomcat/libexec/  (brew info tomcat 으로 확인)
```

**정직하게 적을 것 세 가지:**

1. **지금 Tomcat에 올릴 것이 없다.** 현 코드에는 WAR도 서블릿도 없다. Tomcat 설치는 **전환이 결정된 뒤에** 의미가 생긴다. 전환 비용 견적은 설계자 B(`22-tomcat-and-local-llm.md`)가 낸다.
2. **Tomcat은 프론트엔드를 대체하지 못한다.** 현 UI는 React 19 서버 컴포넌트다. Tomcat으로 가면 프론트를 별도 빌드해 정적 파일로 서빙(Caddy 또는 Tomcat `webapps/ROOT`)해야 하고, **서버 컴포넌트·서버 액션은 통째로 사라진다.** 즉 "백엔드만 Java로"가 아니라 프론트 아키텍처도 바뀐다.
3. **Tomcat 10.1+는 `javax.*` → `jakarta.*` 네임스페이스다.** 인터넷의 옛 예제·라이브러리를 그대로 쓰면 `ClassNotFoundException`으로 죽는다. 신규 개발이라 오히려 유리하지만 알고 시작할 것.

메모리 설정(`setenv.sh`) — **RAM 16GB 확정 기준**:

```bash
# /opt/homebrew/opt/tomcat/libexec/bin/setenv.sh
export CATALINA_OPTS="-Xms256m -Xmx1500m -XX:+UseG1GC -XX:MaxMetaspaceSize=256m \
  -Duser.timezone=UTC -Dfile.encoding=UTF-8"
```

`-Xmx2g`가 아니라 **1500m**이다. 16GB에서 2G 힙은 §3.4 예산표의 여유 10 GB에서 2.5 GB(힙+메타스페이스+스레드 스택)를 가져간다 — **러너 2개 몫**이다.

`-Duser.timezone=UTC`를 빼지 말 것 — §3.3의 DB UTC 규약과 짝이다.

### 4.2.1 Tomcat 도입의 인프라 비용 — 숫자

**코드 재작성 견적은 설계자 B(`22-tomcat-and-local-llm.md`)가 낸다. 여기서는 인프라 측 비용만 숫자로 낸다.**

| 비용 항목 | Node만 | Tomcat 추가 | 증가분 |
|---|---|---|---|
| 상주 RAM(§3.4) | 6.0 GB | 8.5 GB | **+2.5 GB (총 RAM의 16%)** |
| 빌드·러너 가용 여유 | 10.0 GB | 7.5 GB | **−25%** |
| 동시 실행 가능 러너 수(빌드 1개 병행 시) | 3~4개 | **2개** | **−1~2개** |
| 디스크: JDK 21 | — | 0.6 GiB | |
| 디스크: Tomcat + webapps | — | 0.5 GiB | |
| 디스크: Maven/Gradle 캐시 | — | **5~10 GiB** | 캡 대상(§10.3) |
| **디스크 증가분 합계** | — | — | **약 6~11 GiB** |
| 운영 대상 런타임 수 | 1개 | 2개 | 패치·재기동·로그 회전·헬스체크·모니터링이 **전부 2배** |
| 병행 기간(점진 이관) | — | 두 스택 동시 상주 | 위 비용이 이관 완료까지 **계속** 발생 |

**16GB에서 가장 아픈 숫자는 디스크가 아니라 "동시 실행 가능 러너 3~4개 → 2개"다.** 에이전트 코딩 플랫폼의 처리량이 직접 절반 가까이 깎인다. 이 프로젝트의 목적이 러너 처리량이라는 점을 감안하면, **Tomcat 도입 비용의 실체는 재작성 공수보다 이쪽일 수 있다.**

**기각하지 않는다** — 위 비용을 내면 Tomcat은 돈다. RAM을 24GB 이상으로 올린 맥미니라면 이 표의 마지막 행(러너 수 감소)이 사라진다. 결정은 사용자가 한다.

### 4.3 두 갈래를 동시에 굴리는 구성 — 점진 이관 경로

**사용자가 Tomcat을 원하면서 전면 재작성은 피하고 싶다면, 이것이 답이다.** Caddy가 경로로 나눈다.

**전체 Caddyfile은 §5.2.1에 있다**(접속 주체 확정으로 사람 평면·작업 평면이 분리됐기 때문). Tomcat을 붙이려면 그 파일의 사람 평면 블록에 아래 한 덩어리를 **`handle {` 앞에** 추가한다.

```
    # 이관이 끝난 API 만 Tomcat 으로. 처음엔 이 블록이 비어 있다가 하나씩 늘어난다.
    handle /api/v2/* {
        reverse_proxy 127.0.0.1:8080
    }
```

Caddy의 `handle`은 **먼저 매칭된 하나만** 실행되므로, 이 블록을 catch-all `handle {}` 위에 두면 `/api/v2/*`만 Tomcat으로 가고 나머지는 Node로 남는다. **이관 단위가 경로 하나**라는 뜻이다 — 엔드포인트를 하나씩 옮기며 언제든 되돌릴 수 있다.

`flush_interval -1`(SSE 블록)이 실시간의 생사를 가른다. 이게 없으면 프록시가 응답을 모았다가 보내서 실시간이 아니게 된다.

**주의:** 작업 평면(에이전트 API)은 이 분기에 넣지 않는다. 러너 경로는 tailnet 전용이며 Tomcat 이관 대상이 되더라도 §5.2.1의 별도 사이트 블록 안에서 분기해야 한다.

---

## 5. 외부 노출 — 세 방식 비교와 권고

### 5.0 접속 주체가 확정되면서 문제가 둘로 갈라졌다

**확정: 서버에 접속하는 것은 에이전트 러너다. 사람은 WBS 조회와 승인만 한다.**(Q-A 해석 2)

이 확정이 노출 설계를 단순한 하나에서 **성격이 다른 둘**로 쪼갠다.

| 평면 | 주체 | 트래픽 | 경로 | 노출 요구 |
|---|---|---|---|---|
| **작업 평면** | 에이전트 러너(소수·기계) | `/api/v1/agent/work/**` — 목록·claim·report·release | 러너가 도는 PC(운영자가 통제) | **공개 인터넷에 있을 이유가 없다** |
| **사람 평면** | 팀원(계정 52개 실측) | 브라우저 — WBS 조회, `/agent-ops` 승인 | 임의의 사무실·집·모바일 | 공개 웹 필요 |

**핵심 판단: 에이전트 API를 공개 인터넷에서 완전히 제거할 수 있다.** 러너는 운영자가 설치·통제하는 기계이므로 VPN 클라이언트를 깔아도 된다 — 52명에게 요구할 수 없는 것을 러너 3~4대에는 요구할 수 있다.

이것은 큰 보안 이득이다. 현행 에이전트 API의 방어는 공유 시크릿(`AGENT_API_SECRET`) + 미등록 프로젝트 404 두 겹인데(`03-platform-port.md` §5.3), 여기에 **네트워크 계층 하나가 통째로 더 얹히고 공격 표면에서 사라진다.** 시크릿이 유출돼도 tailnet 밖에서는 엔드포인트에 도달조차 못 한다.

### 5.1 비교표

| | ① 고정IP/DDNS + 포트포워딩 | ② Cloudflare Tunnel | ③ Tailscale |
|---|---|---|---|
| 공유기 포트 개방 | **필요**(80/443) | 불필요(아웃바운드만) | 불필요 |
| CGNAT 환경에서 | **불가** | 가능 | 가능 |
| ISP 인바운드 포트 차단 시 | **불가** | 무관 | 무관 |
| 일반 사용자 접속 | 브라우저로 바로 | 브라우저로 바로 | **클라이언트 설치 필요**(Funnel 제외) |
| TLS | 직접 발급·갱신(certbot/Caddy) | **엣지에서 자동** | 자동(내부망) |
| 홈 네트워크 노출 | **직접 노출** — 침해 시 LAN 전체 위험 | 노출 없음 | 노출 없음 |
| 앞단 인증 추가 | 직접 구현 | **Cloudflare Access**(무료 티어 존재) | 기본이 인증된 메시 |
| DDoS/봇 방어 | 없음 | 엣지에서 흡수 | 해당 없음 |
| 비용 | DDNS 무료 가능, 고정IP는 유료 | 터널 무료 · **도메인은 유료** | 소규모 무료 티어 |
| **사람 평면**(브라우저 52계정) | ○ | **◎** | △(전원 설치 요구는 비현실적) |
| **작업 평면**(러너 3~4대) | △ | △ | **◎** |
| 운영자 SSH·DB 관리 | ✕(포트 노출) | △ | **◎** |

### 5.2 권고 — ②와 ③의 **역할 분리** 병행

| 평면 | 방식 | 노출되는 것 |
|---|---|---|
| 사람 평면(WBS 조회·승인) | **Cloudflare Tunnel** | 웹 UI만. `/api/v1/agent/**`는 **차단** |
| 작업 평면(에이전트 러너) | **Tailscale** | 에이전트 API만. tailnet 안에서만 도달 |
| 운영자 SSH·MariaDB | **Tailscale** | 공개 포트 0건 |

근거:
- ①은 한국 가정용 회선에서 **셋 중 둘(포트 차단·CGNAT)에 걸릴 가능성이 높고**, 걸리지 않더라도 홈 LAN을 인터넷에 직접 노출한다. 맥미니 한 대의 취약점이 집 안 전체 기기로 번진다.
- ②는 맥미니가 Cloudflare로 **나가는** 연결만 만든다. 공유기 설정 0건, 공인 IP 불필요.
- ③은 브라우저 사용자에게는 부적합하지만, **러너와 운영자에게는 최적**이다. 러너는 운영자가 통제하는 소수의 기계이므로 클라이언트 설치가 현실적이다(§5.0).

**사람 평면의 부하가 크게 줄었다는 점도 반영한다.** 사람이 하는 일이 조회와 승인뿐이면 동시 접속 피크는 §5.5의 10명 가정보다 낮고, 무거운 산출물 생성(PPT·엑셀)만 간헐적으로 발생한다. 상향 대역 요구는 **피크 10~20 Mbps** 수준으로 내려간다.

### 5.2.1 Caddy — 두 평면을 물리적으로 가르는 설정

`§4.3`의 Caddyfile을 다음으로 대체한다. **핵심은 에이전트 API가 터널 쪽 사이트 블록에 아예 없다는 것**이다.

```
# ── 사람 평면: Cloudflare Tunnel 이 127.0.0.1:80 으로 넣는다 ──
:80 {
    encode zstd gzip
    request_body { max_size 20MB }

    # 에이전트 API 는 공개 경로에 존재하지 않는다.
    # 404 로 응답한다 — 기존 루프의 "미등록 프로젝트 404" 자세와 일관되게,
    # 있다는 사실조차 알리지 않는다.
    handle /api/v1/agent/* {
        respond 404
    }

    handle /api/events* {
        reverse_proxy 127.0.0.1:3000 { flush_interval -1 }   # SSE 버퍼링 금지
    }

    handle {
        reverse_proxy 127.0.0.1:3000
    }

    log {
        output file /opt/homebrew/var/log/caddy/public.log {
            roll_size 50MiB
            roll_keep 5
        }
    }
}

# ── 작업 평면: Tailscale 인터페이스에만 바인딩한다 ──
# <tailscale-ip> 는 `tailscale ip -4` 로 얻은 100.x.x.x 를 넣는다.
# 0.0.0.0 으로 두지 말 것 — 그 순간 LAN 전체에 열린다.
<tailscale-ip>:8443 {
    handle /api/v1/agent/* {
        reverse_proxy 127.0.0.1:3000
    }
    handle { respond 404 }

    log {
        output file /opt/homebrew/var/log/caddy/agent.log {
            roll_size 50MiB
            roll_keep 5
        }
    }
}
```

러너 측 설정은 base URL을 `https://<tailscale-ip>:8443` (또는 MagicDNS 이름)로 바꾸는 것뿐이다. **`AGENT_API_SECRET`은 그대로 유지한다** — 네트워크 방어가 생겼다고 애플리케이션 방어를 빼지 않는다.

**검증 항목(설치 후 반드시):**

```bash
# tailnet 밖(공개 도메인)에서 에이전트 API 가 404 인가
curl -s -o /dev/null -w '%{http_code}\n' https://dflow.example.com/api/v1/agent/work
# → 404 여야 한다. 200/401 이 나오면 노출된 것이다.

# tailnet 안에서는 정상 동작하는가 (시크릿 포함)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $AGENT_API_SECRET" \
  https://<tailscale-ip>:8443/api/v1/agent/work
```

⚠️ 위 두 명령은 **실행하지 않았다.** 실제 응답 코드는 라우트 구현(`src/app/api/v1/agent/work/route.ts`의 게이트)과 Caddy 설정이 함께 결정하므로 설치 후 확인이 필요하다.

### 5.3 Cloudflare Tunnel 설치 절차

**선행: 도메인 하나를 Cloudflare 네임서버로 위임해 둘 것**(터널은 무료지만 도메인은 유료다).

```bash
brew install cloudflared

# 1) 로그인 — 브라우저가 열리고 도메인을 고르면 인증서가 로컬에 저장된다
cloudflared tunnel login

# 2) 터널 생성 (이름은 자유)
cloudflared tunnel create dflow
# → 터널 UUID 와 자격증명 JSON 경로가 출력된다. UUID 를 아래에 쓴다.

# 3) DNS 라우팅 — 이 명령이 Cloudflare 에 CNAME 을 만든다
cloudflared tunnel route dns dflow dflow.example.com

# 4) 설정 파일
mkdir -p ~/.cloudflared
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <터널-UUID>
credentials-file: /Users/<운영자>/.cloudflared/<터널-UUID>.json

ingress:
  - hostname: dflow.example.com
    service: http://127.0.0.1:80        # Caddy 로 보낸다(Caddy 가 Node/Tomcat 분기)
    originRequest:
      # SSE 가 죽지 않게 — 응답 스트리밍을 버퍼링하지 않는다
      disableChunkedEncoding: false
      connectTimeout: 30s
      noTLSVerify: false
  - service: http_status:404
```

```bash
# 5) 포그라운드 시험 기동 — 브라우저로 https://dflow.example.com 확인
cloudflared tunnel run dflow

# 6) 확인되면 서비스로 등록 (§8.3 의 LaunchDaemon 방식과 통일할 것)
sudo cloudflared service install
```

**⚠️ 검증 상태:** 위 절차·파일 형식은 cloudflared 문서 관례를 따른 것이며 **이 세션에서 실행·검증하지 않았다.** cloudflared 버전에 따라 `service install`의 plist 경로와 자격증명 위치가 다르므로, 설치 후 `sudo launchctl list | grep cloudflared`로 실제 등록을 확인할 것.

**터널을 쓸 때 반드시 확인할 것 셋:**
1. **요청 본문 상한** — Cloudflare 프록시에는 플랜별 업로드 상한이 있다(무료 플랜은 100MB급). 우리 실측 최대 파일은 42 kB, 설계 상한은 20 MB이므로 **여유가 있다**(`13-baseline-measurements.md` §3). 다만 상한값 자체는 Cloudflare 플랜 문서에서 재확인할 것.
2. **SSE 통과 여부** — 터널을 켠 뒤 `/api/events`로 실제 스트림이 끊기지 않고 오는지 눈으로 확인. 실패하면 `flush_interval -1`(Caddy)과 응답 헤더 `Cache-Control: no-cache`, `X-Accel-Buffering: no`를 점검.
3. **Cloudflare Access 적용 여부** — 앞단에 하나 더 세울 수 있다. 다만 앱에 이미 자체 인증이 있으므로(§6) **이중 로그인**이 된다. 초기 안정화 기간에만 켜고 이후 끄는 운용을 권고.

### 5.4 Tailscale (관리 평면)

```bash
brew install --cask tailscale
# GUI 로그인 후:
tailscale status
tailscale ip -4                     # 맥미니의 100.x.x.x 주소

# SSH 는 공개 인터넷에 절대 열지 않는다. Tailscale 안에서만.
sudo systemsetup -setremotelogin on          # macOS 원격 로그인(SSH) 활성
```

공유기에서 **22번 포트를 열지 않는다.** Tailscale 네트워크 안에서만 `ssh <운영자>@100.x.x.x`로 붙는다. 에이전트 러너가 다른 개발자 PC에서 돌 경우에도 같은 방식으로 API에 붙게 하면, 러너 인증(`AGENT_API_SECRET`) 위에 네트워크 계층 방어가 하나 더 얹힌다.

### 5.5 가정용 회선의 실제 문제 — 기술이 아니라 계약

**이것을 흐리게 쓰지 않겠다.**

1. **약관.** 국내 주요 ISP의 가정용 인터넷 이용약관에는 통상 **영업 목적 사용·서버 운영·회선 재판매를 제한하는 조항**이 있다. Cloudflare Tunnel은 포트 차단과 CGNAT는 우회하지만 **약관은 우회하지 않는다.** 기술적으로 동작하는 것과 계약상 허용되는 것은 다르다. 회사 업무용 서비스(계정 52개, 실측)를 가정용 회선으로 상시 서비스하는 것은 **약관 위반 소지가 있다.**
   → **권고: 사무실 회선(기업용 상품) 사용, 또는 최소한 가입 ISP에 용도를 문의해 서면 확인.** 이것은 설계자가 결정할 수 없는 사항이므로 사용자에게 올린다.
2. **인바운드 포트 차단.** 가정용 상품에서 80/443 인바운드가 차단되는 경우가 흔하다. ①을 택하면 여기서 막힌다.
3. **CGNAT.** 공인 IP가 할당되지 않는 상품이 있다. ①이 원천 불가가 된다.
4. **상향 대역.** 국내 FTTH는 하향 위주 상품이 많아 **상향이 병목**이 된다. 서버는 상향으로 응답을 내보낸다.

**측정 방법 (맥미니에서 직접):**

```bash
# 1) 공인 IP 가 CGNAT 인지 — 공유기 WAN IP 가 100.64~100.127 대역이면 CGNAT
curl -s https://api.ipify.org; echo
# 공유기 관리페이지의 WAN IP 와 위 값이 다르면 CGNAT 또는 이중 NAT

# 2) 상향 대역 실측
brew install speedtest-cli
speedtest-cli --simple        # Upload 값을 본다
```

**필요 대역 산정 — 두 평면을 따로 잡는다(§5.0):**

| 평면 | 트래픽 성격 | 상향 요구 |
|---|---|---|
| 사람(조회·승인만) | 페이지 1~2 MB, 동시 피크 5명 안팎. 엑셀·PPT 다운로드가 간헐적 스파이크 | **10~20 Mbps 피크** |
| 러너(API) | JSON 요청·응답. 목록·claim·report는 각각 수 KB | **1 Mbps 미만** — 무시할 수준 |

접속 주체가 러너로 확정되면서 사람 트래픽이 "업무 내내 사용"에서 "조회·승인 시 잠깐"으로 줄었다. **상향 20 Mbps면 충분하며 일반 FTTH로 여유롭게 감당된다.** 병목이 생긴다면 대역이 아니라 **PPT/엑셀 생성의 CPU**이고, 16GB RAM 구성에서는 그마저도 러너·빌드와 RAM을 다툰다(§3.4).

**⚠️ 확인 못 한 것:** 실제 회선 상품·상향 실측치·CGNAT 여부. 위 명령으로 사용자가 재야 한다.

---

## 6. 인증 · 세션

설계는 `03-platform-port.md` §3.2에서 이미 확정했다. 여기서는 **자체 호스팅에서 달라지는 것만** 적는다.

| 항목 | 내용 |
|---|---|
| 방식 | 세션 테이블 + HttpOnly 쿠키(JWT 아님). 근거: PostgREST/Storage/Realtime이 사라지면 무상태 검증의 이점이 없다 |
| 비밀번호 해시 | **bcrypt `$2a$`** — 현 52계정 전부 이 형식(`13-baseline-measurements.md` §4). Node `bcrypt`가 그대로 검증하므로 기존 비밀번호 유지가 기술적으로 가능 |
| 쿠키 속성 | `Secure; HttpOnly; SameSite=Lax; Path=/`. **`Secure`가 필수** — Cloudflare Tunnel 경로는 항상 HTTPS이므로 문제없다 |
| 프록시 뒤 클라이언트 IP | Cloudflare가 `CF-Connecting-IP`를 넣는다. 앱이 `X-Forwarded-For`만 보면 **모든 접속이 Cloudflare IP로 기록**된다. 사용 현황(`/usage`) 기록이 무의미해지므로 Caddy에서 헤더를 정리할 것 |
| 신뢰 프록시 | Caddy `trusted_proxies` 를 Cloudflare 대역으로 한정. 안 하면 헤더 위조로 IP 스푸핑이 된다 |
| 세션 만료 | 슬라이딩 만료 + 절대 만료 병행. 세션 테이블이므로 강제 로그아웃은 `DELETE` 한 줄 |
| 관리 평면 | SSH·DB는 Tailscale 안에서만(§5.4). 공개 노출 0 |

### 6.1 러너 인증은 세션과 무관하다 — 두 인증 체계가 공존한다

접속 주체가 러너로 확정되면서 인증이 두 갈래로 분명해졌다.

| | 사람 | 에이전트 러너 |
|---|---|---|
| 인증 수단 | 이메일+비밀번호 → 세션 쿠키 | **공유 시크릿**(`AGENT_API_SECRET`) — 세션·쿠키 없음 |
| 경로 | Cloudflare Tunnel → 웹 UI | Tailscale → `/api/v1/agent/**` |
| 권한 판정 | 3단 권한(`03-platform-port.md` §5.1) | 미등록 프로젝트 404 · 오시크릿 401 |
| 세션 만료 | 적용 | **해당 없음** — 러너는 매 요청 시크릿을 제시 |

**따라서 자체 인증 구현(§6의 세션 설계)이 지연되더라도 러너 루프는 영향받지 않는다.** 두 체계가 독립이라 이식·전환 순서를 나눌 수 있다는 뜻이며, 이는 §14 Q1(러너 전용 먼저)의 실행 가능성을 뒷받침한다.

**단, 시크릿 하나가 러너 전체를 대표한다는 한계는 그대로다.** 러너별 식별·폐기가 필요해지면 러너마다 다른 시크릿을 발급하는 구조가 필요하고, 그것은 설계자 A의 다중 클라이언트 모델(`21-multi-client-model.md`) 소관이다.

---

## 7. 백업 · 복구

### 7.1 원칙

현재 데이터는 **DB 53 MB + 파일 363 kB**다(실측). 즉 **백업이 부담이 되는 규모가 아니다.** 부담이 아니라는 것은 곧 **안 할 핑계가 없다**는 뜻이다.

3-2-1: 로컬 사본 + 외장 SSD + 오프사이트.

### 7.2 일일 백업 스크립트

`/opt/dflow/bin/backup.sh` (퍼미션 750):

```bash
#!/bin/bash
set -euo pipefail

STAMP=$(date -u +%Y%m%d-%H%M%S)
DEST=/opt/dflow/backups
KEEP_DAYS=14
export MYSQL_PWD=$(cat /opt/homebrew/etc/dflow/backup_pw)   # 600, root 소유

mkdir -p "$DEST"

# ── 1) DB 논리 백업 (일관성 있는 스냅샷 + binlog 좌표 기록) ──
/opt/homebrew/bin/mariadb-dump \
  -u dflow_backup --single-transaction --quick --routines --triggers --events \
  --source-data=2 --hex-blob --default-character-set=utf8mb4 \
  dflow | gzip -9 > "$DEST/dflow-$STAMP.sql.gz"

# ── 2) 업로드 파일 ──
tar -czf "$DEST/files-$STAMP.tar.gz" -C /opt/dflow files

# ── 3) 무결성 즉시 확인 — gz 가 깨졌으면 지금 알아야 한다 ──
gzip -t "$DEST/dflow-$STAMP.sql.gz"
gzip -t "$DEST/files-$STAMP.tar.gz"

# ── 4) 오프사이트 (rclone: Cloudflare R2 무료 10GB / Backblaze B2) ──
/opt/homebrew/bin/rclone copy "$DEST/dflow-$STAMP.sql.gz"  remote:dflow-backup/db/  --quiet
/opt/homebrew/bin/rclone copy "$DEST/files-$STAMP.tar.gz" remote:dflow-backup/files/ --quiet

# ── 5) 로컬 보존 기간 초과분 삭제 — 이 줄이 없으면 디스크가 찬다 ──
find "$DEST" -name '*.gz' -type f -mtime +$KEEP_DAYS -delete

echo "[backup] ok $STAMP"
```

```bash
brew install rclone
rclone config          # R2 또는 B2 원격 설정(대화형)
```

`--source-data=2`가 덤프 헤더에 binlog 좌표를 주석으로 남긴다. **PITR은 이 좌표가 있어야 성립한다.**

### 7.3 복구 절차 (리허설용 — 분기 1회 의무)

```bash
# 1) 최신 덤프의 binlog 좌표 확인
zcat /opt/dflow/backups/dflow-<STAMP>.sql.gz | head -40 | grep -i 'CHANGE MASTER\|CHANGE REPLICATION'

# 2) 검증 전용 DB 로 복원 — 운영 DB 에 절대 덮어쓰지 않는다
mariadb -u root -p -e "create database dflow_restore_test"
zcat /opt/dflow/backups/dflow-<STAMP>.sql.gz | mariadb -u root -p dflow_restore_test

# 3) 행 수 대조
mariadb -u root -p -e "
  select 'wbs_items' t, count(*) from dflow_restore_test.wbs_items
  union all select 'minutes', count(*) from dflow_restore_test.minutes;"

# 4) PITR 이 필요하면 덤프 이후 binlog 를 이어 적용
mariadb-binlog --start-position=<좌표> /opt/homebrew/var/mysql-binlog/binlog.0000NN \
  | mariadb -u root -p dflow_restore_test

# 5) 정리
mariadb -u root -p -e "drop database dflow_restore_test"
```

**검증하지 않은 백업은 백업이 아니다.** 리허설 결과(소요 시간·행 수 일치 여부)를 날짜와 함께 기록으로 남길 것.

### 7.4 Time Machine에 대한 경고

Time Machine으로 MariaDB 데이터 디렉터리를 그냥 백업하면 **일관성이 깨진 파일 사본**이 만들어진다(쓰기 도중 복사). 복구했을 때 InnoDB가 손상 상태로 뜰 수 있다.

```bash
# Time Machine 을 쓴다면 DB 데이터·binlog·캐시는 제외한다
sudo tmutil addexclusion /opt/homebrew/var/mysql
sudo tmutil addexclusion /opt/homebrew/var/mysql-binlog
sudo tmutil addexclusion /opt/dflow/releases
sudo tmutil addexclusion ~/.npm
sudo tmutil addexclusion ~/.cache
```

**DB는 반드시 §7.2의 논리 덤프로.** Time Machine은 `/opt/dflow/backups`(이미 만들어진 덤프)와 설정 파일만 담게 한다.

---

## 8. 정전 · 재부팅 자동 복구 — macOS 고유 함정

**여기가 이 문서에서 가장 실수하기 쉬운 절이다.** 리눅스 감각으로 systemd를 찾으면 없고, 있는 것처럼 보이는 `brew services`는 무인 재부팅에서 조용히 안 뜬다.

### 8.1 전원 정책

```bash
# 정전 복구 시 자동 부팅
sudo pmset -a autorestart 1

# 잠들지 않게 (서버가 자면 서비스가 멈춘다)
sudo pmset -a sleep 0
sudo pmset -a disksleep 0
sudo pmset -a displaysleep 10
sudo pmset -a womp 1            # Wake on LAN

# 확인
pmset -g
```

**UPS를 권고한다.** 가정용 전원은 순단이 잦고, `innodb_flush_log_at_trx_commit=1`이 데이터는 지켜도 **반복적인 비정상 종료는 SSD 수명과 파일시스템에 나쁘다.** APC/CyberPower 소형 UPS면 충분하며, macOS는 USB 연결 UPS를 인식해 `pmset`에 배터리 정책을 노출한다.

### 8.2 ⚠️ 함정 1 — FileVault가 무인 재부팅을 막는다

**FileVault가 켜져 있으면, 재부팅 후 누군가 물리적으로 로그인할 때까지 디스크가 잠겨 있어 어떤 서비스도 뜨지 않는다.** 정전 복구가 무의미해진다.

```bash
fdesetup status         # FileVault is On/Off 확인
```

선택지 둘:

| | 내용 |
|---|---|
| **A. FileVault 끄기** | 무인 부팅 가능. 대신 **디스크가 평문**이 된다 — 물리적 도난 시 DB·업로드 파일이 그대로 노출. 서버를 잠긴 공간에 두는 것이 전제 |
| **B. FileVault 유지 + `authrestart`** | 계획된 재부팅은 `sudo fdesetup authrestart`로 1회 잠금 해제를 예약할 수 있다. **그러나 예고 없는 정전에는 통하지 않는다** — 복구에 사람이 필요 |

**권고: 서버를 물리적으로 통제되는 장소에 둘 수 있으면 A, 없으면 B + UPS로 정전 자체를 줄인다.** 어느 쪽이든 **선택했다는 사실을 문서에 남긴다.** 모르고 A가 되어 있는 것과 알고 A를 고른 것은 다르다.

### 8.3 ⚠️ 함정 2 — `brew services`는 기본이 LaunchAgent다

`brew services start`를 **sudo 없이** 실행하면 `~/Library/LaunchAgents/`에 등록되고, 이는 **사용자가 GUI 로그인해야 뜬다.** 무인 재부팅에서는 안 뜬다.

```bash
# 반드시 sudo — /Library/LaunchDaemons/ 에 등록되어 부팅 시 기동한다
sudo brew services start mariadb
sudo brew services start caddy

# 확인: LaunchDaemons 쪽에 있는지
sudo launchctl list | grep -iE 'mariadb|caddy|cloudflared'
ls -la /Library/LaunchDaemons/ | grep -iE 'mariadb|caddy|cloudflared'
```

앱(Node)은 brew 서비스가 아니므로 직접 plist를 쓴다.

`/Library/LaunchDaemons/com.dflow.app.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>com.dflow.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/opt/dflow/current/server.js</string>
  </array>
  <key>WorkingDirectory</key> <string>/opt/dflow/current</string>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key> <false/>
    <key>Crashed</key>        <true/>
  </dict>
  <key>ThrottleInterval</key> <integer>10</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>       <string>production</string>
    <key>PORT</key>           <string>3000</string>
    <key>TZ</key>             <string>UTC</string>
  </dict>
  <key>StandardOutPath</key>   <string>/opt/homebrew/var/log/dflow/app.out.log</string>
  <key>StandardErrorPath</key> <string>/opt/homebrew/var/log/dflow/app.err.log</string>
  <key>UserName</key>          <string>_dflow</string>
</dict>
</plist>
```

```bash
sudo mkdir -p /opt/homebrew/var/log/dflow
sudo chown root:wheel /Library/LaunchDaemons/com.dflow.app.plist
sudo chmod 644        /Library/LaunchDaemons/com.dflow.app.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.dflow.app.plist
sudo launchctl print system/com.dflow.app | head -20
```

**비밀은 plist에 넣지 않는다** — plist는 644라 누구나 읽는다. DB 비밀번호는 앱이 시작할 때 `/opt/homebrew/etc/dflow/env`(600)에서 읽게 한다.

**⚠️ `UserName` 전용 계정(`_dflow`) 생성은 별도 절차다**(`dscl` 사용). 만들지 않았다면 이 키를 지우고 우선 운영자 계정으로 띄운 뒤, 안정화 후 전용 계정으로 내릴 것.

### 8.4 ⚠️ 함정 3 — macOS 자동 업데이트가 서비스를 끊는다

```bash
# 자동 재부팅을 동반하는 업데이트를 끈다(보안 대응은 수동 창구로)
sudo softwareupdate --schedule off
defaults read /Library/Preferences/com.apple.SoftwareUpdate.plist 2>/dev/null
```

끄는 대신 **점검 창을 만들 것** — 분기 1회 계획 재부팅 시 OS 업데이트를 함께 적용한다. 켜 두면 새벽에 말없이 재부팅되고, FileVault가 켜져 있으면 그대로 서비스가 죽는다(§8.2와 연쇄).

### 8.5 기동 순서 확인

부팅 후 이 순서로 살아 있어야 한다.

```bash
# 재부팅 후 확인 스크립트
for s in mariadb caddy cloudflared com.dflow.app; do
  printf "%-16s " "$s"
  sudo launchctl list | grep -q "$s" && echo "up" || echo "DOWN"
done
mariadb -u root -p -e "select 1" >/dev/null && echo "db ok"
curl -sf http://127.0.0.1:3000/api/chat/health >/dev/null && echo "app ok"
curl -sf https://dflow.example.com/login       >/dev/null && echo "public ok"
```

**계획 재부팅 리허설을 초기에 한 번 반드시 할 것.** "정전이 나면 알아서 뜨겠지"는 검증이 아니다.

---

## 9. 256GB 스토리지 용량 산정

### 9.1 먼저 — 실제 쓸 수 있는 용량은 256GB가 아니다

256 GB(십진) = 238.4 GiB. APFS 오버헤드·복구 파티션을 빼면 **macOS가 보고하는 값은 약 228 GiB**다. 현 개발기(256GB 모델) 실측이 정확히 그렇다:

```
/dev/disk3s5   228Gi   178Gi   26Gi   88%   /System/Volumes/Data
```

**설계 기준은 228 GiB.** 그리고 macOS는 여유가 10% 밑으로 내려가면 눈에 띄게 불안정해지므로 **약 23 GiB는 영구히 비워 둬야 한다.** 실제 가용 예산은 **약 205 GiB**다.

### 9.2 예산표 (Node 갈래 · 로컬 LLM 없음)

| 항목 | 예산 | 근거 |
|---|---|---|
| macOS 시스템 볼륨 | 12 GiB | 실측 `df -h /` |
| macOS Data 기본(시스템 캐시·로그) | 8 GiB | |
| **동적 스왑** | **8 GiB** | **RAM 16GB 확정이라 이 항목이 커진다.** 빌드 피크(2~4GB) + 러너 + MariaDB가 겹치면 macOS가 스왑을 확장한다. 16GB 기계에서 스왑이 8 GiB까지 자라는 것은 이상 상황이 아니다(§2.1) |
| Xcode Command Line Tools | 2.2 GiB | **실측** |
| Homebrew(서버용 최소 구성) | 3 GiB | 실측 5.8 GiB는 formula 91개 기준. 서버는 10개 안팎 |
| Node + npm 캐시(**캡 적용 후**) | 3 GiB | 실측 5.1 GiB → §10.3에서 3 GiB로 캡 |
| MariaDB 바이너리 | 1 GiB | |
| MariaDB 데이터 | 5 GiB | 현 데이터 53 MB(실측). 100배 성장을 봐도 여유 |
| binlog(7일 보존) | 3 GiB | `max_binlog_size 128M` × 회전 |
| 앱 릴리스 3세대(standalone) | 4.5 GiB | 세대당 1.5 GiB |
| 업로드 파일 | 10 GiB | 현재 363 kB(실측). 극단적 성장 여유 |
| 로컬 백업 14일 | 5 GiB | 덤프가 압축 후 수십 MB 수준 |
| 로그(Caddy·앱·MariaDB, 회전 적용) | 3 GiB | |
| **에이전트 워크트리** | **7.2 GiB** | **1.8 GiB/개(실측: node_modules 729M + .next 1.0G + 소스)** × **4개** — RAM 16GB에서 동시 러너 상한이 3~4개이므로(§3.4) 워크트리도 4개가 상한이다 |
| 빌드 캐시(`.next/cache`, TS) | 5 GiB | 빌드가 직렬화되므로 1세트 |
| **소계** | **약 75 GiB** | |
| macOS 여유 강제분 | 23 GiB | |
| **잔여** | **약 130 GiB** | |

**RAM 16GB 확정이 디스크 예산을 오히려 편하게 만들었다.** 러너 동시 실행이 3~4개로 묶이면서 워크트리도 4개가 상한이 되고(종전 5~10개 가정 대비 −11 GiB), 빌드가 직렬화되어 캐시가 한 벌만 필요하다. **RAM 제약이 디스크 폭주를 대신 막아 준다** — 다만 그 대가로 스왑 8 GiB가 새로 잡혔다.

### 9.3 Tomcat 갈래를 더하면

| 추가 항목 | 예산 |
|---|---|
| JDK 21 | 0.6 GiB |
| Tomcat + webapps | 0.5 GiB |
| Maven/Gradle 캐시(`~/.m2`, `~/.gradle`) | **5~10 GiB** ← 조용히 커진다. 캡 대상 |
| **추가 소계** | 약 6~11 GiB |

Node와 Tomcat을 **병행**하면(§4.3 점진 이관) 두 스택의 캐시를 동시에 안고 간다. 잔여가 약 119~124 GiB로 줄지만 **디스크 관점에서는 여전히 여유롭다.** Tomcat의 진짜 비용은 디스크가 아니라 RAM이다(§4.2.1).

### 9.4 판정 — 세 시나리오 (RAM 16GB 확정 반영)

| 시나리오 | 판정 |
|---|---|
| **① 전용 서버 · 로컬 LLM 없음** | **넉넉하다.** 약 130 GiB가 남는다. 256GB로 충분하고도 남는다 |
| **② 전용 서버 · 로컬 LLM 있음** | **디스크는 문제가 아니다. RAM이 문제다.** 16GB에서는 7~8B 양자화 모델(개당 4~6 GiB 디스크 / 5~7 GB RAM)이 현실적 상한이고, 그것을 돌리는 순간 빌드·러너 여유가 사라진다(§3.4). **모델 디스크 예산은 15~20 GiB면 충분** — 어차피 그 이상 큰 모델은 못 돌린다. 종전 100 GiB 예산 가정은 RAM 16GB 확정으로 **무효** |
| **③ 개발자 상용 기계 겸용** | **터진다.** 현 개발기가 그 증거다 — 같은 사람이 쓰는 256GB 기계가 **178 GiB 사용·여유 26 GiB(88%)** 다(실측). 여기에 MariaDB·릴리스·백업·워크트리를 얹으면 몇 주 안에 디스크 풀이다 |

**권고: ① 또는 ②. 즉 맥미니를 전용 서버로 격리한다.** 이것이 용량 설계의 전제이며, 지키지 못하면 아래 §10의 방어를 전부 넣어도 시간만 벌 뿐이다.

**결론 한 줄: 256GB 스토리지는 RAM 16GB 확정 아래에서 충분하다.** 16GB RAM이 러너 수·빌드 병렬도·모델 크기를 전부 묶어 주기 때문에, 디스크를 폭주시킬 만한 동시 작업 자체가 발생하지 못한다. **부족한 자원은 디스크가 아니라 RAM이다.**

### 9.5 2026-08-05 장애가 주는 교훈의 정확한 형태

그 장애는 **디스크가 차서 PostgREST가 설정 파일조차 못 읽어 크래시 루프에 빠졌고, 그 결과 커넥션 풀이 고갈된 것**이었다. 표면 증상은 "로그인이 안 됨"이었다.

여기서 옮겨올 교훈은 "디스크를 크게 사라"가 아니다. **디스크가 차면 무관해 보이는 컴포넌트가 이해할 수 없는 방식으로 죽는다**는 것이다. 그리고 이번 구성에서 디스크를 채우는 것은 데이터(53 MB)가 아니라 **캐시·모델·워크트리**다 — 즉 **사람이 만드는 증가분**이고, 따라서 사람이 캡을 걸어야 한다.

---

## 10. 모니터링 · 디스크 알람

### 10.1 2단 알람 + 밸러스트

```bash
# 밸러스트: 5 GiB 더미 파일. 디스크 풀 응급 시 이걸 지워 숨 쉴 공간을 만든다.
sudo mkdir -p /opt/dflow/ballast
sudo dd if=/dev/zero of=/opt/dflow/ballast/BALLAST_5G bs=1m count=5120
sudo chmod 444 /opt/dflow/ballast/BALLAST_5G
```

`/opt/dflow/bin/disk-watch.sh`:

```bash
#!/bin/bash
set -uo pipefail
THRESH_WARN=75
THRESH_CRIT=85
USED=$(df -H /System/Volumes/Data | awk 'NR==2{gsub(/%/,"",$5); print $5}')
AVAIL=$(df -h /System/Volumes/Data | awk 'NR==2{print $4}')

notify() {  # 채널은 §10.4 에서 고른다
  /opt/dflow/bin/notify.sh "$1" "$2"
}

if   [ "$USED" -ge "$THRESH_CRIT" ]; then
  notify "CRIT" "디스크 ${USED}% 사용, 여유 ${AVAIL}. 즉시 조치. 응급: /opt/dflow/ballast/BALLAST_5G 삭제"
  # 자동 1차 방어 — 캐시부터 비운다(서비스 중단 없음)
  /opt/homebrew/bin/npm cache clean --force 2>/dev/null || true
  /opt/homebrew/bin/brew cleanup -s        2>/dev/null || true
  find /opt/dflow/backups -name '*.gz' -mtime +7 -delete
elif [ "$USED" -ge "$THRESH_WARN" ]; then
  notify "WARN" "디스크 ${USED}% 사용, 여유 ${AVAIL}."
fi

# 상위 소비처를 함께 남겨 원인 추적을 짧게 만든다
{ echo "=== $(date -u) used=${USED}% avail=${AVAIL} ==="
  du -sh /opt/dflow/* /opt/homebrew/var/mysql /opt/homebrew/var/mysql-binlog \
         ~/.npm ~/.cache 2>/dev/null | sort -rh | head -10
} >> /opt/homebrew/var/log/dflow/disk.log
```

launchd로 5분마다:

`/Library/LaunchDaemons/com.dflow.diskwatch.plist` — `ProgramArguments`에 위 스크립트, `StartInterval` `300`, `RunAtLoad` `true`.

```bash
sudo launchctl bootstrap system /Library/LaunchDaemons/com.dflow.diskwatch.plist
```

### 10.2 로그 회전 (캡이 없으면 로그가 디스크를 먹는다)

- **Caddy**: §4.3의 `roll_size 50MiB / roll_keep 5` — 이미 캡
- **MariaDB slow/error log**: macOS `newsyslog`에 항목 추가

`/etc/newsyslog.d/dflow.conf`:

```
# logfilename                                    [owner:group]  mode count size(KB) when  flags
/opt/homebrew/var/mysql-log/slow.log             _mysql:_mysql  644  5     51200    *     GZ
/opt/homebrew/var/mysql-log/error.log            _mysql:_mysql  644  5     10240    *     GZ
/opt/homebrew/var/log/dflow/app.out.log          :             644  5     51200    *     GZ
/opt/homebrew/var/log/dflow/app.err.log          :             644  5     51200    *     GZ
```

**⚠️ 소유자·경로는 실제 설치 후 `ls -l`로 확인해 채울 것.** 위 값은 형식 예시다.

### 10.3 성장하는 것마다 캡

| 대상 | 캡 방법 |
|---|---|
| binlog | `binlog_expire_logs_seconds = 604800` (§3.3) |
| 로컬 백업 | `find … -mtime +14 -delete` (§7.2) |
| npm 캐시 | `npm config set cache-max 604800` + 주 1회 `npm cache clean --force`. **실측 5.1 GiB까지 자란다** |
| Homebrew 캐시 | 주 1회 `brew cleanup -s`. 실측 635 MiB |
| 앱 릴리스 | 3세대만 유지: `ls -1dt /opt/dflow/releases/* \| tail -n +4 \| xargs rm -rf` |
| **에이전트 워크트리** | **개수 상한 4개**(RAM 16GB의 동시 러너 상한과 일치, §3.4). 개당 1.8 GiB(실측). 작업 종료 시 `git worktree remove` + `node_modules` 삭제를 러너 종료 훅에 넣을 것(설계자 B 영역) |
| `.next/cache` | 릴리스 교체 시 이전 세대와 함께 삭제 |
| 로컬 모델 파일 | **디렉터리 하나로 모으고 총량 상한 20 GiB**(`/opt/dflow/models`). 16GB RAM에서 7~8B급 이상은 못 돌리므로 그 이상 받아둘 이유가 없다(§9.4 ②) |
| Maven/Gradle(Tomcat 갈래) | 월 1회 정리 |
| **스왑** | 캡을 걸 수 없다(macOS가 관리). 대신 **감시한다** — §10.1의 `disk-watch.sh`에 아래를 추가 |

```bash
# 스왑이 커지고 있다 = RAM 이 부족하다 = 러너를 줄이거나 빌드를 직렬화하라는 신호
SWAP=$(sysctl -n vm.swapusage | awk '{print $6}')     # 예: 4096.00M
echo "swap_used=$SWAP" >> /opt/homebrew/var/log/dflow/disk.log
```

스왑 증가는 **디스크 알람보다 먼저 오는 조기 경보**다. RAM 16GB 구성에서 이것을 안 보면, 디스크 75% 알람이 울릴 때는 이미 성능이 무너진 뒤다.

### 10.4 알람 채널

이 리포에는 **이미 nodemailer SMTP 발송 경로가 있다**(`src/lib/mail/transport.ts`). 별도 인프라 없이 메일 알람을 붙일 수 있는 것이 가장 큰 이점이다.

`/opt/dflow/bin/notify.sh`는 다음 중 하나를 감싼다:

| 채널 | 평가 |
|---|---|
| **메일(기존 SMTP 재사용)** | **권고.** 추가 의존 0. 단 **DB/앱이 죽으면 메일도 못 보낼 수 있다** → 앱을 거치지 말고 스크립트가 직접 SMTP로 보낼 것 |
| macOS 알림 센터(`osascript -e 'display notification'`) | 로컬 콘솔에서만 보인다. 무인 서버에는 부적합 |
| Telegram Bot API(`curl`) | 외부 의존이 생기지만 **앱과 완전히 독립**이라 앱이 죽어도 알람이 산다. 보조 채널로 권고 |

**권고: 주 채널 메일 + 보조 채널 하나(앱과 독립).** 단일 채널이면 "알람 시스템이 같이 죽는" 경우를 못 막는다.

### 10.5 헬스 체크

```bash
# /opt/dflow/bin/health.sh — 2분마다 launchd
curl -sf --max-time 10 http://127.0.0.1:3000/api/chat/health >/dev/null \
  || /opt/dflow/bin/notify.sh "CRIT" "앱 헬스체크 실패"
mariadb -u dflow_backup -e "select 1" >/dev/null 2>&1 \
  || /opt/dflow/bin/notify.sh "CRIT" "DB 응답 없음"
curl -sf --max-time 15 https://dflow.example.com/login >/dev/null \
  || /opt/dflow/bin/notify.sh "WARN" "외부 경로(터널) 응답 없음"
```

세 계층(앱·DB·터널)을 따로 봐야 한다. 하나로 묶으면 **어디가 죽었는지 모른 채 알람만 온다** — 2026-08-05에 "로그인이 안 됨"이라는 증상만 보고 원인이 디스크라는 데 도달하기까지 걸린 시간이 그 대가였다.

---

## 11. 설치 순서 (체크리스트)

실행 순서다. 각 단계의 확인 명령을 통과해야 다음으로 간다.

| # | 작업 | 확인 |
|---|---|---|
| 1 | 맥미니를 전용 서버로 격리할지 결정(§9.4) | 결정 기록 |
| 2 | FileVault 정책 결정·적용(§8.2) | `fdesetup status` |
| 3 | 전원 정책(§8.1) | `pmset -g` |
| 4 | 자동 업데이트 정책(§8.4) | — |
| 5 | Homebrew 설치 | `brew --version` |
| 6 | Tailscale 설치·관리 접속 확립(§5.4) | `tailscale status` · Tailscale 경유 SSH 성공 |
| 7 | MariaDB **버전 확인 후** 설치(§3.1~3.2) | `brew info mariadb` ≥ 11.8 |
| 8 | `dflow.cnf` 배치(§3.3) — `innodb_buffer_pool_size = 1G`(16GB 확정값, §3.4) | — |
| 9 | 기동 + 보안 초기화(§3.5) | `select @@time_zone` → `+00:00` |
| 10 | **벡터 기능 실증(§3.6)** | `vec_distance_cosine` 쿼리 성공 |
| 11 | 계정 3종 생성(§3.7) | `show grants` |
| 12 | Node(+선택적으로 JDK/Tomcat) 설치(§4) | `node -v` |
| 13 | Caddy 설치 + **두 평면 Caddyfile** 배치(§5.2.1) | `caddy validate` |
| 14 | 앱 LaunchDaemon 등록(§8.3) | `launchctl print system/com.dflow.app` |
| 15 | 도메인 준비 + Cloudflare Tunnel(§5.3) | 외부에서 `https://…/login` 200 |
| 15b | **평면 분리 실증**(§5.2.1) | 공개 도메인의 `/api/v1/agent/work` → **404** · tailnet 경유 → 정상 |
| 15c | **러너 1대를 tailnet으로 붙여 claim 왕복**(§5.0) | 목록→claim→report→release 성공 |
| 16 | **SSE 통과 확인**(§5.3 주의 2) | 스트림 끊김 없음 |
| 17 | 백업 스크립트 + rclone 원격(§7.2) | 덤프 생성·`gzip -t` 통과·원격 업로드 확인 |
| 18 | **복구 리허설 1회**(§7.3) | 행 수 대조 일치 |
| 19 | 밸러스트·디스크 감시·로그 회전(§10.1~10.2) | `disk.log`에 기록 생성 |
| 20 | 알람 채널 2개(§10.4) | 임계값을 일시적으로 낮춰 **실제 알람 수신 확인** |
| 21 | 헬스 체크(§10.5) + **스왑 감시**(§10.3) | — |
| 22 | **계획 재부팅 리허설**(§8.5) | 전 서비스 자동 기동 |
| 23 | 회선 측정(§5.5) — CGNAT·상향 대역 | 기록 |
| 24 | ISP 약관 확인 또는 사무실 회선 검토(§5.5) | **사용자 결정 필요** |
| 25 | **러너 동시 실행 부하 시험** — 러너 3~4개 + 빌드 1개를 동시에 돌려 RAM·스왑을 관측(§3.4) | 스왑 급증 없음. 급증하면 러너 상한을 내린다 |

20번과 22번을 건너뛰지 말 것. **알람이 실제로 오는지, 재부팅 후 실제로 뜨는지를 확인하지 않은 시스템은 그 둘이 없는 시스템과 같다.**

---

## 12. 기존 문서와의 충돌 · 무효화

| 문서 | 항목 | 상태 |
|---|---|---|
| `03-platform-port.md` | §6.1 "자체 호스팅 단일 VM(Linux)" | **부분 무효.** 대상이 Linux VM → macOS 맥미니로 바뀌었다. **결론(자체 호스팅)은 유지되나 수단이 전부 다르다** — systemd → launchd, 패키지 매니저 → Homebrew, FileVault 함정 신규 |
| `03-platform-port.md` | §6.1 "서버리스 배제 4가지 이유" | **유지.** 넷 다 그대로 성립 |
| `03-platform-port.md` | §8 D3 "사내 서버가 있는가" | **해소.** 맥미니가 그 서버다. 다만 §5.5의 회선·약관 문제가 새 미해결로 대체된다 |
| `03-platform-port.md` | §9 R5 "운영 부담이 개발을 잡아먹는다" | **상향.** Linux VM보다 macOS 서버 운영이 함정이 많다(§8의 셋). 리스크가 커졌다 |
| `03-platform-port.md` | §3.5 "단일 인스턴스 전제" / R6 | **유지·강화.** 맥미니 1대이므로 단일 인스턴스가 물리적으로 확정된다. SSE 인메모리 pub/sub이 안전해지는 대신, **이 기계가 SPOF**다 |
| `04-pm-synthesis.md` | P4 "사내 서버 없음/미확인" | **해소** |
| `04-pm-synthesis.md` | P3 "Tomcat 기각" | **이 문서는 판정하지 않는다.** §4.2·§4.3에 설치 절차와 병행 구성을, §4.2.1에 **인프라 비용을 숫자로** 제시했다. 코드 재작성 견적은 설계자 B |
| `05-pm-brief-selfhost.md` | Q-A 세 해석 | **해석 2 확정**(러너만 접속). 이 문서 §5.0·§5.2.1·§6.1이 그 확정을 반영한 결과다 |
| `05-pm-brief-selfhost.md` | §3 "RAM 미확인, 시나리오별로" | **해소 — 16GB 확정.** 이 문서는 16GB 단일 전제로 재작성됐고, 다른 용량은 §3.4 각주로만 남았다 |
| 이 문서 초판 | "로컬 LLM 모델 예산 60~100 GiB" | **무효.** RAM 16GB에서 그 크기의 모델을 못 돌린다 → **20 GiB로 축소**(§9.4 ②, §10.3) |
| 이 문서 초판 | "워크트리 5~10개 / 9~18 GiB" | **무효.** 동시 러너 상한 3~4개에 맞춰 **4개 / 7.2 GiB**(§9.2) |
| `13-baseline-measurements.md` | §3 Storage 363 kB | **활용.** §9.2 업로드 예산(10 GiB)과 §4.3 요청 본문 상한(20 MB)의 근거 |

---

## 13. 리스크

| # | 리스크 | 어디서 터지는가 | 완화 |
|---|---|---|---|
| **R1** | **맥미니가 단일 장애점(SPOF)** | 이 기계가 죽으면 서비스가 멈춘다. Vercel+Supabase에는 없던 위험이다. 하드웨어 고장·SSD 수명·도난·화재 | 오프사이트 백업(§7.2)이 유일한 실질 방어. **복구 목표시간(RTO)을 사용자와 합의할 것** — "며칠 멈춰도 되는가"에 답이 없으면 이 구성은 승인될 수 없다 |
| **R2** | **디스크 풀 재발** | 캐시·모델·워크트리가 조용히 자란다. 2026-08-05와 같은 형태로, 무관해 보이는 곳이 죽는다 | §10 전부. 특히 캡과 밸러스트. **③ 개발 겸용을 택하면 이 방어가 무의미해진다** |
| **R2b** | **RAM 16GB가 진짜 병목이고, 그것이 디스크 풀로 번진다** | 러너를 욕심내 5~6개 붙이거나 빌드를 병렬로 돌리면 스왑이 폭증하고, 스왑이 디스크를 먹어 R2로 이어진다. **RAM 부족은 "느려짐"이 아니라 "디스크 풀"로 나타난다** | 동시 러너 상한 4개를 **운영 규칙이 아니라 러너 측 코드로 강제**할 것(설계자 B). 빌드 직렬화. §10.3 스왑 감시를 조기 경보로 |
| **R2c** | **로컬 LLM을 켜는 순간 러너가 멈춘다** | 7~8B 모델 하나가 RAM 5~7 GB를 잡으면 가용 10 GB에서 빌드 1개 돌릴 여유밖에 안 남는다. "모델도 돌리고 러너도 4개"는 16GB에서 성립하지 않는다 | 로컬 LLM과 러너 실행을 **시간대로 분리**하거나, 모델을 포기하고 구독 CLI만 쓴다(설계자 B의 실행 모델 판단과 직결) |
| **R3** | **FileVault + 정전 = 무인 복구 실패** | 새벽 정전 → 재부팅 → 디스크 잠김 → 아침까지 서비스 정지 | §8.2 결정을 문서화. UPS |
| **R4** | **ISP 약관 위반** | 기술이 아니라 계약에서 터진다. 회선 해지·제재는 예고 없이 온다 | §5.5. **사무실 회선 또는 ISP 서면 확인.** 이것만은 기술적 우회를 권하지 않는다 |
| **R5** | **운영자가 1명** | 이 문서의 절차를 아는 사람이 자리를 비우면 아무도 손대지 못한다 | 절차서를 리포에 유지(이 문서), 계정·비밀번호를 팀 비밀 저장소에 이중화, §11 체크리스트를 실제 수행 기록으로 남길 것 |
| **R6** | **알람이 서비스와 함께 죽는다** | 앱 경유 메일 알람은 앱이 죽으면 안 온다 | §10.4 보조 채널(앱 독립) |
| **R7** | **MariaDB 11.8 벡터 기능이 기대와 다르다** | §3.6 실증 전에는 P2 결정 전체가 미검증이다 | 설치 직후 §3.6을 반드시 통과시킬 것. 실패 시 `03-platform-port.md` §3.4 안 2(앱 브루트포스)로 전환 — **1,390행이므로 성립한다**(`13-baseline-measurements.md` §2) |
| **R8** | **맥미니 도입이 경로 β를 뒤집는다** | MariaDB를 지금 설치한다는 것은 사실상 이식 착수다. `04-pm-synthesis.md` P1(기능 먼저)과 충돌 | **분기를 명시할 것**(§14 Q1) |

---

## 14. 사용자·PM 확인이 필요한 사항

| # | 질문 | 설계자 C 권고 |
|---|---|---|
| **Q1** | 맥미니를 **지금** 서비스 서버로 만드는가, 아니면 **에이전트 러너 전용**으로 먼저 쓰고 서비스 이전은 나중인가 | **러너 전용 먼저.** P1(경로 β)과 충돌하지 않고, 현 개발기 여유 26 GiB 문제(PM §3)를 즉시 해소하며, 맥미니 운영에 익숙해질 시간을 번다. 서비스 이전은 기능이 검증된 뒤 §11 체크리스트로 |
| **Q2** | 맥미니는 **전용 서버**인가 개발 겸용인가 | **전용.** §9.4 ③은 현 개발기의 88%가 실증한다 |
| **Q3** | FileVault를 끄는가(무인 부팅) 유지하는가(물리 보안) | 서버를 잠긴 공간에 둘 수 있으면 **끈다**. 아니면 유지 + UPS |
| **Q4** | 회선: 가정용인가 사무실인가 | **사무실 회선 권고.** 가정용이면 §5.5의 약관 확인이 선행 |
| **Q5** | 도메인이 있는가 | Cloudflare Tunnel에 필요. 없으면 취득(연 유료). **사람 평면에만 필요하므로, Q1에서 "러너 전용 먼저"를 택하면 이 항목도 나중으로 미룰 수 있다** |
| **Q6** | 복구 목표시간(RTO)은 며칠인가 | 답이 없으면 R1을 평가할 수 없다. **이 질문에 답하기 전에는 서비스 이전을 승인하지 말 것** |
| **Q7** | ~~맥미니 RAM 실제 값~~ | **해소 — 16GB 확정.** 본 문서 전체가 이 값으로 재작성됨 |
| **Q8** | 동시 러너 상한 4개를 수용하는가 | 이것이 이 하드웨어의 처리량 상한이다. 더 필요하면 **RAM 24GB 이상 기기**가 답이지 튜닝이 아니다. Tomcat까지 얹으면 2개로 준다(§4.2.1) |

---

## 15. 모르는 것 / 확인하지 못한 것

1. **맥미니의 macOS 버전·현재 실제 여유 디스크.** RAM은 16GB로 확정됐으나, 이 문서의 모든 **용량 숫자는 현 개발기(MacBook Air M3, 256GB 모델) 실측을 근거로 한 추정**이다. 맥미니에서 재측정해야 한다.
1-b. **§3.4 RAM 예산표의 각 프로세스 상주값.** macOS 유휴 3.5GB·Node 0.8GB·러너 0.5~1.5GB는 **일반적 관측 범위이지 이 기계의 실측이 아니다.** §11-25(부하 시험)에서 실측해 표를 교정할 것. 특히 **에이전트 러너 1개의 실제 RAM 사용량**은 설계자 B의 실행 모델(구독 CLI vs 로컬 모델)에 따라 크게 달라진다.
2. **Homebrew에 MariaDB 11.8이 있는지.** 조회하지 않았다(§3.1). 없으면 설치 경로가 통째로 바뀐다.
3. **MariaDB 벡터 함수의 정확한 시그니처와 동작.** §3.6의 쿼리는 문서 관례 기반이며 **실행하지 않았다.**
4. **cloudflared·Caddy·newsyslog 설정 파일의 실제 경로·소유자.** 버전과 설치 방식에 따라 다르다. 각 절의 ⚠️ 표시 참조.
5. **Cloudflare 무료 플랜의 정확한 요청 본문 상한과 SSE 동작.** 우리 실측 파일 크기(최대 42 kB)로는 여유가 크지만, 상한값 자체는 확인하지 않았다.
6. **한국 각 ISP 약관의 정확한 조항 번호와 문구.** "통상 제한 조항이 있다"까지가 이 문서가 말할 수 있는 범위이며, **계약 확인은 사용자가 해야 한다.**
7. **전력 소비·발열·소음.** 24시간 가동 시의 실제 비용을 산정하지 않았다.
8. **`next.config.ts`의 `output: 'standalone'` 추가가 현 빌드에 미치는 영향.** 현재 이 설정이 없다는 것만 실측했고, 추가 시 `outputFileTracingIncludes`(PPTX 템플릿)와의 상호작용은 검증하지 않았다.
