# Deep Interview Spec: ssenrah TUI Agent Harness

## Metadata
- Interview ID: ssenrah-tui-harness-2026-03-10
- Rounds: 9
- Final Ambiguity Score: 14.8%
- Type: brownfield
- Generated: 2026-03-10
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 35% | 0.315 |
| Constraint Clarity | 0.85 | 25% | 0.213 |
| Success Criteria | 0.82 | 25% | 0.205 |
| Context Clarity | 0.80 | 15% | 0.120 |
| **Total Clarity** | | | **0.852** |
| **Ambiguity** | | | **14.8%** |

## Goal

Go + Bubbletea로 만드는 커스텀 AI 에이전트 하네스 TUI. 개발자가 각 컴포넌트를 인터페이스 기반으로 교체/수정할 수 있는 모듈형 아키텍처. Top-down 접근 — TUI 셸부터 만들고 에이전트 기능을 하나씩 쌓아올림.

## Constraints

- **Language:** Go
- **TUI Framework:** Bubbletea (Charm ecosystem)
- **LLM Providers:** OpenRouter API (멀티 모델), OpenAI Codex OAuth
- **Architecture:** 인터페이스 기반 모듈형 — 모든 주요 컴포넌트가 Go interface 뒤에
- **Repository:** ssenrah 레포 내 (예: `harness/` 디렉토리)
- **Target Users:** 개발자
- **Customization 2-tier:**
  - No-code tier: 프롬프트, 훅 — 코드 수정 없이 교체/추가
  - Code tier: 도구, 정책, 프로바이더, 에이전트 루프, TUI — 디렉토리별 분리 + 인터페이스
- **기존 GUI 앱:** 별도 — 이미 있는 코딩 에이전트 설정용. 미래에 하네스 모듈 구조와 연동 예정

## Non-Goals

- v0.1에서 도구 시스템 구현 (v0.3+)
- v0.1에서 멀티 에이전트/팀 오케스트레이션
- v0.1에서 MCP 지원
- v0.1에서 정책/안전 레이어
- oh-my-openagent 포크 또는 기존 도구 확장 (처음부터 새로 만듦)
- TUI 내 커서 스크롤 같은 과도한 기능

## Acceptance Criteria

### v0.1 — TUI Shell
- [ ] Go + Bubbletea 기반 TUI가 터미널에서 실행됨
- [ ] 사용자 입력 → 더미 LLM 응답 (스트리밍 시뮬레이션)
- [ ] 마크다운 렌더링: 볼드, 이탤릭, 코드 블록 (syntax highlighting), 테이블, 헤더
- [ ] 사이드바 기본 표시: 모델명, 프로바이더, 토큰 수, 비용, 활동 로그
- [ ] Tab 키로 사이드바 토글 (열기/닫기)
- [ ] 터미널 크기 변경 시 레이아웃 실시간 적응
- [ ] 좁은 터미널: 사이드바 정보가 상단 바로 압축
- [ ] 도구 호출 승인/거부 UI 틀 (아직 실제 도구 없이 시각적 구조만)
- [ ] 입력부에 모델/프로바이더/비용 표시
- [ ] 하단 상태바: 키보드 단축키 안내

### v0.2 — Provider Layer
- [ ] OpenRouter API 연동 → 실제 LLM 스트리밍 응답
- [ ] OpenAI Codex OAuth 연동
- [ ] Provider 인터페이스 정의 — 새 프로바이더 추가가 인터페이스 구현만으로 가능
- [ ] 모델 선택 UI (사이드바 또는 커맨드)
- [ ] 토큰 사용량/비용 실시간 추적

### v0.3+ — Agent Loop & Tools
- [ ] 단일 에이전트 루프 (멀티턴)
- [ ] 도구 인터페이스 정의 + 첫 번째 도구 구현
- [ ] 도구 호출 → 승인 UI → 실행 → 결과 표시 플로우
- [ ] 시스템 프롬프트 외부 파일로 관리 (no-code customization)
- [ ] 프롬프트/루프/도구 반복 개선

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| oh-my-openagent 포크하면 빠르다 | Contrarian: 왜 새로 만드는가? | TS는 버벅임. Go 성능 우위 + clean modular start로 커스터마이징 용이 + 미래에 GUI 연동 |
| TUI에 모든 기능 필요 | Simplifier: v0.1 최소 범위? | v0.1은 채팅+스트리밍+마크다운+사이드바. 도구/MCP/팀은 이후 |
| Adaptive 레이아웃 필요 | 사이드바 자동 숨김? | 토글 자체가 adaptive. 기본은 열어두고 사용자가 Tab으로 제어 |
| 멀티 프로바이더 복잡 | 비용 현실성 | OpenRouter로 모델 취사선택 + Codex OAuth. 현실적 비용 관리 |

## Technical Context

**ssenrah 레포 현황:**
- `app/` — Tauri + React GUI 앱 (에이전트 설정 도구, 별도)
- `ARCHITECTURE.md` — 이전 TS 하네스 설계 문서 (삭제 예정이었으나 참고용)
- `PLAN-GUI.md` — GUI 기획 문서
- `docs/spec_ssenrah_gui/` — GUI 기술 스펙 (10개 문서)
- 하네스 런타임 코드: 의도적으로 삭제됨 (c780e26)
- Go 모듈 신규 생성 필요 (예: `harness/` 디렉토리)

**참고 대상:**
- oh-my-openagent: UI 구조 참고 (사이드바 레이아웃, 마크다운 렌더링)
- Claude Code / Codex: 기능 벤치마크 (대화형 에이전트, 도구 승인, 멀티턴)

## Ontology (Key Entities)
| Entity | Fields | Relationships |
|--------|--------|---------------|
| TUI | layout, sidebar, input, chat_area, status_bar | renders Messages, shows Status |
| Message | role, content, timestamp | displayed in chat_area |
| Sidebar | model, provider, tokens, cost, activity | toggleable, adapts to width |
| Provider (v0.2) | name, api_key, endpoint, models | interface: SendMessage, Stream |
| Tool (v0.3) | name, description, parameters, execute | interface: called by Agent |
| Agent (v0.3) | system_prompt, provider, tools, loop | orchestrates conversation |

## Proposed Directory Structure
```
harness/
├── go.mod
├── go.sum
├── main.go                 # entrypoint
├── cmd/                    # CLI entrypoint
├── internal/
│   ├── tui/                # Bubbletea TUI components
│   │   ├── app.go          # root model
│   │   ├── chat.go         # chat area
│   │   ├── sidebar.go      # sidebar panel
│   │   ├── input.go        # input area
│   │   ├── statusbar.go    # bottom status bar
│   │   ├── markdown.go     # markdown renderer
│   │   └── theme.go        # colors, styles
│   ├── provider/           # LLM provider interface + implementations
│   │   ├── provider.go     # interface definition
│   │   ├── openrouter.go   # OpenRouter implementation
│   │   └── codex.go        # Codex OAuth implementation
│   ├── agent/              # agent loop (v0.3)
│   │   └── agent.go
│   ├── tool/               # tool interface + implementations (v0.3)
│   │   └── tool.go
│   ├── policy/             # policy engine (v0.4+)
│   │   └── policy.go
│   └── config/             # configuration loading
│       └── config.go
├── prompts/                # system prompts (no-code customizable)
│   └── default.md
└── hooks/                  # hook definitions (no-code customizable)
    └── README.md
```

## Roadmap
```
v0.1  TUI Shell          채팅 + 스트리밍(더미) + 마크다운 + 사이드바 + adaptive
  ↓
v0.2  Provider Layer      OpenRouter + Codex OAuth → 실제 LLM 응답
  ↓
v0.3  Single Agent        에이전트 루프 + 첫 도구 + 승인 플로우
  ↓
v0.4  Safety & Policy     허용/거부 규칙, 정책 엔진
  ↓
v0.5  Multi-Agent         팀 오케스트레이션, 태스크 그래프
  ↓
v0.6+ GUI Integration     ssenrah GUI와 모듈 구조 연동
```

## Interview Transcript
<details>
<summary>Full Q&A (9 rounds)</summary>

### Round 1
**Q:** "너처럼"이라고 하셨는데 — Claude Code에서 구체적으로 어떤 측면을 닮기를 원하시나요?
**A:** 전체 패키지 (대화형 REPL + 도구 사용 + 승인 흐름 + 멀티턴)
**Ambiguity:** 71.5%

### Round 2
**Q:** TUI를 만들 언어/프레임워크는 뭐로 생각하세요?
**A:** Go. TUI가 어떻게 생겼고 얼마나 부드럽게 작동하는지가 관건. 이전 아키텍처도 일부러 날렸음.
**Ambiguity:** 60%

### Round 3
**Q:** TUI 첫 버전이 완성되었다고 느끼려면, 구체적으로 어떤 것이 동작해야 하나요?
**A:** oh-my-openagent 수준 — 터미널 크기 인식 adaptive UI, 오른쪽 사이드바 (도구/MCP/팀 상태), 마크다운 렌더링 (볼드, 이탤릭, 코드 블록, 표, 헤더). 기존 도구에 꿇리면 의미 없음.
**Ambiguity:** 44.5%

### Round 4
**Q:** 이 하네스가 지원해야 할 LLM 프로바이더 범위는?
**A:** OpenRouter API + OpenAI Codex OAuth. 토큰 비용 현실적 관리.
**Ambiguity:** 40.8%

### Round 5 (Contrarian)
**Q:** oh-my-openagent를 fork하거나 확장하는 게 아니라 새로 만들어야 하는 이유는?
**A:** oh-my-openagent는 TS only, 때때로 버벅임. Clean modular start — 각 컴포넌트 개조/수정 쉽게. 미래에 ssenrah GUI가 모듈 구조 기반으로 개인별 엔지니어링 가능하게. 차별점은 아직 확정 안 됨.
**Ambiguity:** 38.3%

### Round 6
**Q:** "각 컴포넌트를 개조하고 수정해서 발전시키기 쉽게" — 구체적으로 어떤 단위가 교체 가능해야?
**A:** 인터페이스 기반으로 모든 부분. 프롬프트/훅은 no-code 교체. 도구/정책/프로바이더/에이전트 루프/TUI는 디렉토리별 분리 + 인터페이스.
**Ambiguity:** 32.3%

### Round 7 (Simplifier)
**Q:** v0.1의 가장 단순한 모습은?
**A:** 사이드바 + adaptive 레이아웃까지 포함. 도구/MCP/멀티에이전트는 없지만 TUI 구조는 완성.
**Ambiguity:** 27.3%

### Round 8
**Q:** TUI 레이아웃 방향은? (고정 사이드바 / 토글 / adaptive 하이브리드)
**A:** 토글 자체가 이미 adaptive. 기본은 열어두기.
**Ambiguity:** 24.1%

### Round 9
**Q:** 이 하네스는 ssenrah 레포 안에? 별도 레포?
**A:** ssenrah 레포 안에.
**Ambiguity:** 14.8% ✓

</details>
