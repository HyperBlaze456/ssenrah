# ssenrah Roadmap — Post-MVP Expansion Plan (Beyond Claude Code / Codex)

> Generated: 2026-02-26  
> Scope: `examples/` TypeScript harness  
> Intent: MVP 졸업 이후, **안전성 + 자율성 + 구성 가능성**에서 기존 CLI 에이전트 제품군을 넘어서는 기반 구축

---

## 0) North Star

ssenrah는 단순 “코드 작성 에이전트”가 아니라:

1. **Harness를 조립/실험/배포**할 수 있고  
2. 실패를 예측·격리·복구하며  
3. 사람 승인/정책/평가를 기본 내장한  
4. **신뢰 가능한 자율 실행 플랫폼**이 되는 것을 목표로 한다.

---

## 1) MVP Graduation Snapshot (현재 기준선)

현재 코드베이스(`examples/`)에서 확보된 기반:

- Provider-agnostic agent loop (`agent/`, `providers/`)
- Intent gate + fallback + beholder + event logging (`harness/`)
- Hook/Component/Markdown skill 기반 주입 (`harness/hooks.ts`, `harness/skills.ts`, `harness/components/`)
- Tool registry + pack 분리 주입 (`tools/registry.ts`)
- Vision QA를 Markdown skill + 분리 툴로 전환 완료

즉, “단일 에이전트 루프 + 일부 팀 기능”에서 **하네스 구조화의 최소 기반**은 확보됨.

---

## 2) Post-MVP Strategic Tracks

## T-1. Reliability Kernel v2 (Fail-safe by default)

- [ ] 런타임 상태기계(phase machine) 정식화: `planning/executing/reconciling/await_user/failed/completed`
- [ ] 정책 위반 시 fail-closed 공통 에러 모델 도입
- [ ] 작업 중단/재개(checkpoint) 표준 인터페이스 정의
- [ ] 하드 캡(시간/비용/툴호출/재시도) 중앙 집행기 구현
- [ ] “3회 동일 실패” 루프 차단기(circuit breaker) 내장

**Acceptance**
- 동일 입력/정책에서 결정적 결과 재현
- 런타임 cap 초과 시 무조건 `await_user` 전환
- 무한 루프/툴 폭주 회귀 테스트 통과

---

## T-2. Adaptive Orchestration (팀/서브팀 자율 조정)

- [ ] TaskGraph mutable patch 표준 (`expectedVersion`, conflict retry) 확장
- [ ] Reconcile 전략 플러그인화(event-driven 우선)
- [ ] 실패 전파 기본값은 `strict` 유지, `reconcilable`는 명시적 플래그/정책에서만 허용
- [ ] 보상 태스크(compensating task) 정책 기반 생성
- [ ] 서브팀(hierarchy) 기능은 post-MVP 트랙으로 분리(기본 비활성)

**Acceptance**
- stale patch deterministic rejection
- reconcile 2회 이상 실행 시에도 상태 일관성 보장
- 보상 태스크 예산 초과 시 즉시 user gate

---

## T-3. Skill/Tool/Component Runtime Platform

- [ ] Markdown skill schema 표준화(frontmatter contract)
- [ ] Skill loader에 trust/profile 검증 추가
- [ ] Tool pack manifest (`toolpacks/*.json|md`) 도입
- [ ] Component activation rule(훅 조건식) DSL 초안
- [ ] “필요한 도구만 주입” 원칙 전 모드 적용

**Acceptance**
- 하나의 task가 요구한 pack 외 도구 사용 금지 가능
- skill/tool/component hot-swap 시 코어 코드 수정 없이 동작

---

## T-4. Evaluation-first Development (Bench + Regression Gates)

- [ ] `examples/evals/` 신설 (task set + scoring)
- [ ] Terminal-Bench subset adapter 초안
- [ ] Safety incidents / retry count / cost / latency 계량화
- [ ] release gate를 “테스트 + eval + 안전지표” 결합형으로 승격
- [ ] regression snapshot 리포트 자동 생성

**Acceptance**
- PR마다 pass/fail + 점수 변화 확인 가능
- 안전 사고 지표(threshold) 초과 시 배포 차단

---

## T-5. Human-in-the-loop Governance

- [ ] 고위험 도구(`write/exec/network/destructive`) 승인 정책 엔진
- [ ] 승인 UI/CLI 프로토콜 (`approve/reject/timeout`)
- [ ] 감사 추적(누가/언제/무엇 승인) 이벤트 표준화
- [ ] 권한 프로파일: local-permissive / strict / managed

**Acceptance**
- 승인 필요 정책에서 우회 실행 0건
- 감사 로그에서 의사결정 체인 재구성 가능

---

## T-6. Memory & Context Continuity

- [ ] 장기 작업용 checkpoint+resume 프로토콜
- [ ] 요약 메모리/작업 메모리/정책 메모리 계층 분리
- [ ] context compaction 시 필수 상태 자동 보존
- [ ] cross-session handoff 포맷 설계

**Acceptance**
- 세션 중단 후 재개 시 목표/제약/진행률 보존
- compaction 이후 작업 드리프트 감소

---

## T-7. Harness Builder UX (CLI를 넘어)

- [ ] 하네스 설정을 코드가 아닌 선언형 파일로 구성
- [ ] 모델/툴/스킬/정책 조합 프리셋 시스템
- [ ] 온보딩 wizard (로컬 앱 또는 웹 콘솔 전제 설계)
- [ ] 실행 중 시각화(phase, budget, risk, events) 강화

**Acceptance**
- 신규 하네스 생성 시간이 10분 이내
- “코드 수정 없이” 조합 변경 가능

---

## T-8. Secure Remote Execution

- [ ] 로컬/원격 sandbox 추상화 계층
- [ ] 원격 실행 시 비밀정보 redaction 및 로그 분리
- [ ] workspace isolation + capability boundary 검증
- [ ] 연결 단절/복구 시 안전 중단 프로토콜

**Acceptance**
- 원격 실패 시 데이터 유출 없이 안전 종료
- 복구 후 재실행 가능

---

## 3) Phase Plan
DO EVERYTHING!

---

## 4) Rollout Gates

## Gate A → B
- [ ] build/test 완전 통과
- [ ] circuit breaker 회귀 테스트 통과
- [ ] tool pack 격리 테스트 통과
- [ ] eval baseline 리포트 생성 성공

## Gate B → C
- [ ] reconcile/compensation 시나리오 테스트 통과
- [ ] approval bypass 0건
- [ ] 안전지표 임계치 이하

## Gate C → D
- [ ] checkpoint/resume 재현성 확보
- [ ] harness preset 교체 실험 통과
- [ ] 실사용 시나리오 eval 점수 목표 달성

---

## 5) Immediate Backlog (이번 스프린트 시작점)

1. [x] `examples/harness/policy-engine.ts` 신설 (cap + approval 정책 집행)
2. [x] `examples/harness/runtime-phase.ts` 신설 (phase machine + transitions)
3. [x] `examples/evals/` 디렉토리 + 첫 baseline task set 추가
4. [x] `examples/tests/`에 gate 테스트 묶음(`gates.test.ts`) 생성
5. [ ] tool pack manifest 파일 포맷 초안 작성
6. [ ] `agent-cli`에 risk/approval 상태 패널 추가
7. [ ] checkpoint 파일 포맷(`.ssenrah/checkpoints/*.json`) 초안 구현
8. [x] 회귀 자동 리포트 스크립트 추가 (`npm run eval:baseline`)

---

## 6) Success Metrics (제품 관점)

- 안전: destructive/무승인 실행 사고 **0건**
- 신뢰성: 동일 태스크 재실행 결과 편차 최소화
- 비용: 불필요 툴 호출/루프 비율 지속 감소
- 속도: 신규 하네스 조립 시간 단축
- 성능: 내부 eval에서 분기별 지속 개선

---

## 7) Non-Goals (지금 당장 안 함)

- 대규모 플러그인 마켓 공개 배포
- 무제한 계층 팀(depth 무한) 허용
- 원격 실행 기본 활성화
- 사람 승인 없이 고위험 도구 완전 자동화
