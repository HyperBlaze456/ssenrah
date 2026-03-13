# P0: Auto Agent Discovery, Team Formation & Parallel Execution (+ Tmux)

> **Scope**: Orchestrator가 태스크를 분석해서 자동으로 최적 agent type을 매핑하고, Tmux 기반 프로세스 격리로 진짜 병렬 실행을 지원하며, idle worker를 감지/독촉하는 시스템.

---

## Requirements Summary

1. **Auto Agent Matching**: Orchestrator가 태스크를 분류(category)하고, 등록된 agent type 중 최적 매칭을 자동 수행
2. **Auto Team Formation**: 태스크 목록을 받으면 필요한 agent type 조합을 자동 산출하여 팀 편성
3. **Tmux 기반 Worker 격리**: 각 worker를 별도 tmux pane에서 실행하여 진짜 OS-level 병렬성 확보
4. **Todo Enforcer**: idle worker 감지 → 독촉 메시지 전송 → 재시작 판단 (기존 ReconcileLoop heartbeat 대체)
5. **Enhanced Background Parallel Execution**: 현재 `Promise.allSettled` 기반에서 tmux pane 기반으로 확장

---

## Acceptance Criteria

- [ ] AC1: `TeamTask`에 `agentType?: string`, `category?: TaskCategory` 필드 추가됨
- [ ] AC2: Orchestrator가 태스크 분해 시 각 태스크에 category를 자동 할당하며, `validateAndNormalizeTasks()`가 category 필드를 파싱/보존함
- [ ] AC3: `AgentMatcher`가 category → agent type 매핑을 수행하고, 매칭 실패 시 fallback type 사용. 키워드 충돌 시 weighted score 기반 최고점 선택
- [ ] AC4: `AgentTypeRegistry`에 4개 기본 agent type이 사전 등록됨 (explorer, coder, verifier, reviewer)
- [ ] AC5: `TeamFormation`이 태스크 목록을 받아 dependency-aware worker 구성(타입별 수량, 배치별)을 자동 산출
- [ ] AC6: `TmuxPool`이 tmux session/pane을 생성/관리/정리하며, tmux 미설치 시 자동 in-process fallback
- [ ] AC7: Worker가 tmux pane 안에서 격리 실행되고, 파일 기반 IPC로 결과 수집 (setInterval 폴링)
- [ ] AC8: `TodoEnforcer`가 heartbeat 기반으로 idle worker를 감지하고 독촉 메시지 전송. ReconcileLoop의 heartbeat 검사를 대체함
- [ ] AC9: idle 상태가 enforcer 임계값 초과 시 `"killed by TodoEnforcer"` 에러로 worker kill → `shouldRestartWorker()`가 이를 인식하여 재시작
- [ ] AC10: 기존 `Promise.allSettled` 경로가 tmux 없이도 동작함 (in-process fallback)
- [ ] AC11: 신규 모듈 테스트 작성됨 — `matcher.test.ts`, `formation.test.ts`, `defaults.test.ts`, `tmux-pool.test.ts`, `todo-enforcer.test.ts`, `tmux-worker-runner.test.ts` + 통합 테스트 2개
- [ ] AC12: `TeamRuntimeEventType`에 `enforcer_nudge`, `enforcer_kill` 이벤트 타입 추가됨

---

## Implementation Steps

### Phase 1: Task Categorization & Agent Matching

#### Step 1.1: Task Category 타입 정의
**File**: `harness/teams/types.ts` (수정)

```typescript
export type TaskCategory =
  | "explore"       // 코드베이스 탐색, 구조 파악
  | "implement"     // 새 기능 구현, 코드 작성
  | "refactor"      // 기존 코드 개선
  | "test"          // 테스트 작성/실행
  | "verify"        // 결과 검증, 리뷰
  | "debug"         // 버그 분석, 디버깅
  | "document"      // 문서 작성
  | "generic";      // 분류 불가

export const VALID_TASK_CATEGORIES: readonly TaskCategory[] = [
  "explore", "implement", "refactor", "test", "verify", "debug", "document", "generic"
] as const;
```

`TeamTask` 인터페이스에 추가:
```typescript
export interface TeamTask {
  // ... existing fields ...
  category?: TaskCategory;
  agentType?: string;        // 매칭된 agent type name
  agentTypeSource?: "auto" | "manual" | "fallback";  // 매칭 출처
}
```

#### Step 1.2: Default Agent Types 사전 등록
**File**: `harness/agents/defaults.ts` (신규)

기본 agent type 4종을 정의하고 registry에 등록하는 유틸리티:

| Agent Type | Category 매핑 | Model 힌트 | Tool Packs | Isolation |
|---|---|---|---|---|
| `explorer` | explore | fast model (Haiku/Flash) | filesystem, spawn | readOnly: true |
| `coder` | implement, refactor | capable model (Sonnet/Pro) | filesystem, spawn | readOnly: false |
| `verifier` | verify, test | capable model | filesystem | readOnly: true, maxTurns: 5 |
| `reviewer` | debug, document | capable model | filesystem, spawn | readOnly: true |

```typescript
export const DEFAULT_CATEGORY_MAP: ReadonlyMap<TaskCategory, string> = new Map([
  ["explore", "explorer"],
  ["implement", "coder"],
  ["refactor", "coder"],
  ["test", "verifier"],
  ["verify", "verifier"],
  ["debug", "reviewer"],
  ["document", "reviewer"],
  ["generic", "coder"],     // fallback
]);

export function registerDefaultAgentTypes(
  registry: AgentTypeRegistry,
  options?: { modelOverrides?: Record<string, string> }
): void;
```

#### Step 1.3: AgentMatcher 구현
**File**: `harness/agents/matcher.ts` (신규)

Orchestrator의 태스크 분해 결과를 받아 각 태스크에 최적 agent type을 매핑:

```typescript
export interface MatchResult {
  taskId: string;
  category: TaskCategory;
  agentType: string;
  confidence: number;       // 0-1, 매칭 신뢰도
  source: "auto" | "manual" | "fallback";
}

export class AgentMatcher {
  constructor(
    private registry: AgentTypeRegistry,
    private categoryMap?: Map<TaskCategory, string>,  // 커스텀 매핑
    private fallbackType?: string                      // 기본: "coder"
  );

  // 단일 태스크 매칭
  match(task: TeamTask): MatchResult;

  // 배치 매칭 (팀 전체)
  matchAll(tasks: TeamTask[]): MatchResult[];
}
```

**매칭 로직 (우선순위)**:
1. `task.agentType`이 이미 지정됨 → 그대로 사용 (source: `"manual"`, confidence: 1.0)
2. `task.category`가 있음 → categoryMap에서 조회 (source: `"auto"`, confidence: 0.9)
3. 둘 다 없음 → 태스크 description 키워드 분석으로 category 추론 (source: `"auto"`, confidence: score 기반)

**키워드 분석 — Weighted Score 방식 (충돌 해결)**:

각 category에 키워드 + 가중치를 부여. description에서 매칭되는 키워드 가중치를 category별로 합산. 최고 점수 category를 선택:

```typescript
const KEYWORD_WEIGHTS: Record<TaskCategory, Array<{ keyword: string; weight: number }>> = {
  explore:   [{ keyword: "explore", weight: 3 }, { keyword: "find", weight: 2 },
              { keyword: "search", weight: 2 }, { keyword: "list", weight: 1 },
              { keyword: "structure", weight: 2 }, { keyword: "understand", weight: 2 }],
  implement: [{ keyword: "implement", weight: 3 }, { keyword: "create", weight: 3 },
              { keyword: "build", weight: 3 }, { keyword: "add", weight: 2 },
              { keyword: "write code", weight: 3 }, { keyword: "new feature", weight: 3 }],
  refactor:  [{ keyword: "refactor", weight: 3 }, { keyword: "improve", weight: 2 },
              { keyword: "optimize", weight: 2 }, { keyword: "clean up", weight: 2 }],
  test:      [{ keyword: "test", weight: 3 }, { keyword: "spec", weight: 3 },
              { keyword: "assert", weight: 3 }, { keyword: "coverage", weight: 2 }],
  verify:    [{ keyword: "verify", weight: 3 }, { keyword: "validate", weight: 3 },
              { keyword: "review", weight: 2 }, { keyword: "check result", weight: 2 }],
  debug:     [{ keyword: "debug", weight: 3 }, { keyword: "fix bug", weight: 3 },
              { keyword: "investigate", weight: 2 }, { keyword: "trace", weight: 2 }],
  document:  [{ keyword: "document", weight: 3 }, { keyword: "readme", weight: 3 },
              { keyword: "comment", weight: 2 }, { keyword: "explain", weight: 2 }],
  generic:   [],  // no keywords — pure fallback
};
```

예시: "implement a search feature"
- `implement` category: "implement" (3) = 3
- `explore` category: "search" (2) = 2
- 결과: `implement` 승 (3 > 2), confidence = 3 / (3+2) = 0.6

모든 category가 0점 → `"generic"` → fallbackType (source: `"fallback"`, confidence: 0.0)

#### Step 1.4: Orchestrator 통합
**File**: `harness/teams/orchestrator.ts` (수정)

현재 orchestrator는 태스크를 `{ id, description, blockedBy, priority }` 형태로만 분해함.

**1.4a — System prompt 수정**:
```
기존: "Break the goal into discrete tasks. Return JSON array..."
변경: "Break the goal into discrete tasks. For each task, also classify its category
       from: explore, implement, refactor, test, verify, debug, document, generic.
       Return JSON array with fields: id, description, blockedBy, priority, category"
```

**1.4b — `validateAndNormalizeTasks()` 수정** (orchestrator.ts:183-263):

`category` 필드를 optional로 파싱. 유효하지 않은 값은 조용히 무시 (에러 아님):

```typescript
// validateAndNormalizeTasks() 내부, 기존 priority 처리 로직(line 229-237) 바로 뒤에 추가:
const rawCategory = (raw as Record<string, unknown>).category;
let category: TaskCategory | undefined;
if (typeof rawCategory === "string" && VALID_TASK_CATEGORIES.includes(rawCategory as TaskCategory)) {
  category = rawCategory as TaskCategory;
}
// else: LLM이 category를 안 줬거나 잘못된 값 → undefined (AgentMatcher가 키워드로 추론)

// 반환 객체에 category 추가 (line 244-251):
return {
  id: normalizedId,
  description: desc,
  blockedBy: normalizedDeps,
  priority: priority ?? 0,
  status: "pending" as const,
  category,  // ← 추가
};
```

**1.4c — `plan()` 메서드에서 AgentMatcher 호출**:

```typescript
// plan() 메서드 내, validateAndNormalizeTasks() 호출 후:
const tasks = validateAndNormalizeTasks(rawTasks);

// AgentMatcher가 있으면 자동 매칭 수행
if (this.agentMatcher) {
  const matchResults = this.agentMatcher.matchAll(tasks);
  for (const result of matchResults) {
    const task = tasks.find(t => t.id === result.taskId);
    if (task) {
      task.category = result.category;
      task.agentType = result.agentType;
      task.agentTypeSource = result.source;
    }
  }
}
```

#### Step 1.5: Team Formation 자동화
**File**: `harness/agents/formation.ts` (신규)

태스크 목록에서 필요한 worker 구성을 자동 산출. **Dependency-aware**: 같은 배치에 들어갈 태스크만 고려.

```typescript
export interface WorkerSlot {
  agentType: string;
  count: number;             // 해당 타입이 필요한 총 수
  concurrentMax: number;     // 동시 실행 가능 최대 수
}

export interface BatchPlan {
  batchIndex: number;
  tasks: TeamTask[];         // 이 배치에서 실행할 태스크
  requiredTypes: Map<string, number>;  // agentType → count
}

export interface TeamFormation {
  slots: WorkerSlot[];
  batches: BatchPlan[];
  totalWorkers: number;
  estimatedBatches: number;
}

export function computeFormation(
  tasks: TeamTask[],
  matchResults: MatchResult[],
  taskGraph: TaskGraph,        // dependency 정보 사용
  maxWorkers: number
): TeamFormation;
```

**로직**:
1. `taskGraph.claimReadyTasks()`로 현재 실행 가능한 태스크 파악
2. 실행 가능 태스크를 agentType별로 그룹화
3. `maxWorkers` 제한 내에서 배치 구성
4. 향후 배치는 dependency 해소 순서로 예측 (estimatedBatches)

---

### Phase 2: Tmux 기반 Worker 격리

> **전제**: `mkdir -p harness/execution/` — 신규 디렉토리 생성 필요

#### Step 2.1: TmuxPool 구현
**File**: `harness/execution/tmux-pool.ts` (신규)

tmux session/pane 라이프사이클 관리:

```typescript
export interface TmuxPane {
  paneId: string;            // tmux pane identifier (e.g. %3)
  sessionName: string;
  windowIndex: number;
  workerId: string;          // 할당된 worker ID
  status: "idle" | "running" | "finished" | "failed";
  pid?: number;              // pane 내 프로세스 PID
  createdAt: Date;
  lastActivityAt: Date;
}

export class TmuxPool {
  constructor(private config: {
    sessionPrefix: string;      // "ssenrah-team-{runId}"
    maxPanes: number;           // maxWorkers와 동기화 (반드시 일치)
    cleanupOnExit: boolean;     // 기본 true
  });

  // tmux 바이너리 존재 확인 + session 생성. 없으면 TmuxNotAvailableError throw
  async init(): Promise<void>;

  // tmux 설치 여부 확인 (static, init 전에 호출 가능)
  static async isAvailable(): Promise<boolean>;

  // 새 pane 할당 (idle pane 재사용 또는 신규 생성)
  async allocate(workerId: string): Promise<TmuxPane>;

  // pane에서 명령 실행 (ts-node worker script)
  async exec(paneId: string, command: string): Promise<void>;

  // pane stdout 캡처 (tmux capture-pane) — 디버깅용 보조
  async capture(paneId: string, options?: { start?: number; end?: number }): Promise<string>;

  // pane 상태 확인 (프로세스 alive 여부)
  async isAlive(paneId: string): Promise<boolean>;

  // pane에 텍스트 전송 (send-keys, 독촉용)
  async sendKeys(paneId: string, text: string): Promise<void>;

  // pane 해제 (kill-pane)
  async release(paneId: string): Promise<void>;

  // 전체 session 정리. process.on('exit') + SIGINT/SIGTERM에도 등록
  async cleanup(): Promise<void>;

  // 활성 pane 목록
  list(): TmuxPane[];
}
```

**tmux 명령어 매핑**:
- `isAvailable()`: `which tmux` → exit code 0 확인. **최소 tmux 1.8** 필요 (`tmux -V` 파싱)
- `init()`: `tmux new-session -d -s {sessionPrefix}`
- `allocate()`: `tmux split-window -t {session}` 또는 idle pane 재사용
- `exec()`: `tmux send-keys -t {paneId} '{command}' Enter`
- `capture()`: `tmux capture-pane -t {paneId} -p`
- `isAlive()`: `tmux list-panes -t {session} -F '#{pane_id} #{pane_pid}'` 파싱
- `sendKeys()`: `tmux send-keys -t {paneId} '{text}' Enter`
- `release()`: `tmux kill-pane -t {paneId}`
- `cleanup()`: `tmux kill-session -t {sessionPrefix}`

**프로세스 정리 보장**:
```typescript
// init() 내부:
const cleanupHandler = () => this.cleanup().catch(() => {});
process.on("exit", cleanupHandler);
process.on("SIGINT", cleanupHandler);
process.on("SIGTERM", cleanupHandler);
```

#### Step 2.2: TmuxWorkerRunner 구현
**File**: `harness/execution/tmux-worker-runner.ts` (신규)

tmux pane 안에서 worker를 실행하고 결과를 수집하는 브릿지:

```typescript
export interface WorkerRunSpec {
  workerId: string;
  task: TeamTask;
  agentType: AgentType;
  providerConfig: { type: string; model: string; apiKey?: string };  // 직렬화 가능
  timeoutMs: number;
  signal?: AbortSignal;
}

export class TmuxWorkerRunner {
  constructor(
    private pool: TmuxPool,
    private options: {
      workerScriptPath: string;   // worker entry point
      ipcDir: string;             // /tmp/ssenrah-{runId}/
    }
  );

  // tmux pane에서 worker 실행, 결과 대기
  async run(spec: WorkerRunSpec): Promise<TeamTask>;
}
```

**IPC 메커니즘 (tmux pane ↔ orchestrator)**:
- 파일 기반 IPC: `/tmp/ssenrah-{runId}/{workerId}/`
  - `input.json`: 태스크 + agent config (직렬화 가능한 형태)
  - `output.json`: 실행 결과
  - `heartbeat`: 타임스탬프 (worker가 5초마다 `Date.now()` 기록)
  - `status`: `"running"` | `"done"` | `"failed"`
- **Atomic write**: 모든 IPC 파일 쓰기는 `tmp + rename` 패턴 사용:
  ```typescript
  // 직접 구현 (외부 유틸 없음):
  const tmpPath = `${finalPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, data, "utf-8");
  fs.renameSync(tmpPath, finalPath);
  ```
- **Status 폴링**: `setInterval(500ms)` 기반. `fs.watch`는 사용하지 않음 (WSL 비호환)
- timeout 시 tmux pane kill → 결과 없이 task failed 처리

#### Step 2.3: Worker Entry Script
**File**: `harness/execution/worker-entry.ts` (신규)

tmux pane 내에서 독립 프로세스로 실행되는 worker script:

```typescript
// #!/usr/bin/env ts-node (또는 pre-compiled JS로 cold-start 최적화)
//
// 1. argv[1]에서 ipcDir 경로 수신
// 2. input.json 읽기 (task, providerConfig, agentType)
// 3. status 파일에 "running" 쓰기
// 4. Provider 초기화 (providerConfig에서)
// 5. Agent 초기화 (agentType 설정 반영)
// 6. Heartbeat 루프 시작:
//    setInterval(() => atomicWrite(heartbeatPath, Date.now().toString()), 5_000)
// 7. Agent.run(task.description) 실행
// 8. output.json에 결과 쓰기 (atomic write)
// 9. status 파일에 "done" 또는 "failed" 쓰기 (atomic write)
// 10. Heartbeat 루프 중지
// 11. 프로세스 종료 (exit 0 또는 1)
```

**Cold-start 최적화 참고** (Phase 2 완료 후 추적):
- `ts-node` 부트스트랩은 pane당 2-5초 소요 (known limitation)
- 향후 개선: `tsc` pre-compile → `node dist/worker-entry.js`로 전환 가능
- 또는 pane을 미리 할당하고 "wait for input" 모드로 대기시키는 warm pool 패턴

#### Step 2.4: Team 클래스 통합
**File**: `harness/teams/team.ts` (수정)

현재 `Promise.allSettled` 기반 실행을 tmux 모드와 in-process 모드로 분기:

```typescript
export interface TeamConfig {
  // ... existing fields ...
  execution?: {
    mode: "in-process" | "tmux";   // 기본: "in-process" (기존 동작)
    tmux?: {
      sessionPrefix?: string;
      cleanupOnExit?: boolean;
    };
  };
}
```

**모드 결정 로직** (run() 시작 부분):
```typescript
let effectiveMode: "in-process" | "tmux" = config.execution?.mode ?? "in-process";

if (effectiveMode === "tmux") {
  const tmuxAvailable = await TmuxPool.isAvailable();
  if (!tmuxAvailable) {
    console.warn("[ssenrah] tmux not available, falling back to in-process mode");
    effectiveMode = "in-process";
  }
}
```

**실행 흐름 변경**:
```
기존 (in-process, 변경 없음):
  batch = taskGraph.claimReadyTasks(maxWorkers)
  Promise.allSettled(batch.map(task => executeWithRestart(worker, task, ...)))

변경 (tmux 모드):
  batch = taskGraph.claimReadyTasks(maxWorkers)
  for each task in batch:
    matchedType = agentMatcher.match(task)
    pane = tmuxPool.allocate(workerId)
    promise = tmuxRunner.run({ task, agentType: matchedType, ... })
    runningWorkers.push(promise)
  await Promise.allSettled(runningWorkers)
```

---

### Phase 3: Todo Enforcer (Idle Worker 감시)

> **핵심 설계 결정**: TodoEnforcer가 heartbeat 기반 idle 감지의 **단일 권한자(sole authority)**.
> ReconcileLoop의 기존 heartbeat-stale 검사(`reconcile.ts:114-136`)는 TodoEnforcer 활성 시 **비활성화**.

#### Step 3.1: TodoEnforcer 구현
**File**: `harness/execution/todo-enforcer.ts` (신규)

heartbeat 기반 idle worker 감지 및 독촉:

```typescript
export interface EnforcerConfig {
  idleThresholdMs: number;       // idle 판정 임계값 (기본 30초)
  nudgeIntervalMs: number;       // 독촉 간격 (기본 15초)
  maxNudges: number;             // 최대 독촉 횟수 (기본 3)
  nudgeMessage: string;          // 독촉 메시지 템플릿
  killAfterMaxNudges: boolean;   // 최대 독촉 후 kill (기본 true)
}

export interface WorkerStatus {
  workerId: string;
  taskId: string;
  paneId?: string;               // tmux 모드일 때
  lastHeartbeat: Date;
  nudgeCount: number;
  status: "active" | "idle" | "nudged" | "killed";
}

// TodoEnforcer가 kill할 때 사용하는 에러 메시지 상수
export const ENFORCER_KILL_REASON = "killed by TodoEnforcer" as const;

export class TodoEnforcer {
  constructor(
    private config: EnforcerConfig,
    private pool: TmuxPool | null,       // tmux 모드일 때만
    private eventBus: TeamEventBus,      // 이벤트 발행용
    private abortControllers?: Map<string, AbortController>  // in-process 모드: workerId → controller
  );

  // 감시 시작 (setInterval 기반)
  start(): void;

  // 감시 중지
  stop(): void;

  // heartbeat 수신 — in-process 모드: worker가 직접 호출. tmux 모드: 파일 폴링으로 수신
  heartbeat(workerId: string): void;

  // worker 등록 (실행 시작 시 team.ts에서 호출)
  register(workerId: string, taskId: string, paneId?: string): void;

  // worker 등록 해제 (실행 완료/실패 시)
  unregister(workerId: string): void;

  // 현재 상태 조회
  getStatuses(): WorkerStatus[];

  // 단일 체크 사이클 (테스트용 export)
  async tick(): Promise<void>;
}
```

**Tick 로직**:
1. 모든 등록된 worker의 heartbeat 확인
2. `now - lastHeartbeat > idleThresholdMs` → idle 판정, status를 `"idle"` 또는 `"nudged"`로 변경
3. idle worker에게 독촉:
   - **tmux 모드**: `pool.sendKeys(paneId, nudgeMessage)` — 직접 pane에 텍스트 전송
   - **in-process 모드**: `abortControllers`에서 해당 worker의 controller를 찾아 사용하지 않음 (nudge는 mailbox 불가 — worker가 LLM 응답 대기 중이므로 mailbox를 읽지 않음). 대신 nudge를 이벤트로만 기록하고, kill 시에만 AbortController.abort() 호출
4. `nudgeCount >= maxNudges && killAfterMaxNudges` → kill:
   - **tmux 모드**: `pool.release(paneId)` → worker 프로세스 종료
   - **in-process 모드**: `abortControllers.get(workerId).abort(ENFORCER_KILL_REASON)` → agent loop 중단
   - 양쪽 모두: 에러 메시지는 `ENFORCER_KILL_REASON` (`"killed by TodoEnforcer"`)
5. 이벤트 발행:
   - `eventBus.emit({ type: "enforcer_nudge", actor: "todo-enforcer", payload: { workerId, taskId, nudgeCount } })`
   - `eventBus.emit({ type: "enforcer_kill", actor: "todo-enforcer", payload: { workerId, taskId, reason: ENFORCER_KILL_REASON } })`

#### Step 3.2: `shouldRestartWorker()` 수정
**File**: `harness/teams/team.ts` (수정, line 63-66)

TodoEnforcer kill도 재시작 대상에 포함. **주의**: 실제 시그니처는 `(task: TeamTask)` — `task.error`에서 문자열 매칭:

```typescript
// 기존 (team.ts:63-66):
function shouldRestartWorker(task: TeamTask): boolean {
  const error = task.error ?? "";
  return error.includes("killed by Beholder") || error.includes("timed out");
}

// 변경:
import { ENFORCER_KILL_REASON } from "../execution/todo-enforcer";

function shouldRestartWorker(task: TeamTask): boolean {
  const error = task.error ?? "";
  return (
    error.includes("killed by Beholder") ||
    error.includes("timed out") ||
    error.includes(ENFORCER_KILL_REASON)
  );
}
```

#### Step 3.3: ReconcileLoop heartbeat 비활성화
**File**: `harness/teams/reconcile.ts` (수정, line 114-136)

TodoEnforcer가 활성일 때 ReconcileLoop의 heartbeat-stale 검사를 건너뛰도록 수정.
**주의**: `skipHeartbeatCheck`는 **construction-time 주입** — ReconcileLoop의 constructor input에 추가 (readonly field로 저장):

```typescript
// ReconcileLoop constructor input 확장 (reconcile.ts:42-55):
constructor(input: {
  policy: RuntimePolicy;
  mailbox: PriorityMailbox;
  state: TeamStateTracker;
  skipHeartbeatCheck?: boolean;  // 신규: TodoEnforcer 활성 시 true
}) {
  this.policy = input.policy;
  this.mailbox = input.mailbox;
  this.state = input.state;
  this.skipHeartbeatCheck = input.skipHeartbeatCheck ?? false;
}

private readonly skipHeartbeatCheck: boolean;

// run() 내부 heartbeat 검사 부분 (line 114-136):
if (!this.skipHeartbeatCheck) {
  // 기존 heartbeat stale 검사 로직
  const staleHeartbeats = state.getStaleHeartbeats(
    policy.caps.heartbeatStalenessMs
  );
  // ...
}
```

**Team.ts에서 연결** — construction 시점에 플래그 전달:
```typescript
// ReconcileLoop 생성 시 (team.ts 내):
const reconcileLoop = new ReconcileLoop({
  policy: runtimePolicy,
  mailbox: priorityMailbox,
  state: stateTracker,
  skipHeartbeatCheck: true,  // TodoEnforcer가 heartbeat 전담
});
```

#### Step 3.4: Heartbeat 프로토콜 강화 — Team-level 발행
**File**: `harness/teams/team.ts` (수정) — `worker.ts`는 변경하지 않음

**설계 결정**: heartbeat은 `Team.run()`의 배치 실행 루프에서 발행. `WorkerAgent`에 enforcer 의존성을 주입하지 않음 (계층 분리 유지).

```typescript
// Team.run() 내부, 배치 실행 시:
const activeWorkerIds = new Set<string>();

// 배치 시작 시 worker 등록 + heartbeat 루프 시작:
for (const task of batch) {
  const workerId = `worker-${task.id}`;
  activeWorkerIds.add(workerId);
  enforcer.register(workerId, task.id, pane?.paneId);
}

// Team-level heartbeat interval (5초 간격):
const heartbeatInterval = setInterval(() => {
  for (const workerId of activeWorkerIds) {
    enforcer.heartbeat(workerId);
  }
}, 5_000);

// 배치 실행:
const settled = await Promise.allSettled(
  batch.map(task => executeWithRestart(worker, task, timeoutMs, restartLimit))
);

// 배치 완료 후 정리:
clearInterval(heartbeatInterval);
for (const workerId of activeWorkerIds) {
  enforcer.unregister(workerId);
}
activeWorkerIds.clear();
```

**tmux 모드에서의 heartbeat**: worker-entry.ts가 파일 기반 heartbeat을 자체적으로 처리 (Step 2.3).
TodoEnforcer는 tmux 모드일 때 IPC 디렉토리의 heartbeat 파일을 폴링하여 수신:
```typescript
// TodoEnforcer.tick() 내 tmux 모드 heartbeat 수집:
if (this.pool && this.ipcDir) {
  for (const status of this.statuses.values()) {
    const heartbeatPath = path.join(this.ipcDir, status.workerId, "heartbeat");
    try {
      const ts = parseInt(fs.readFileSync(heartbeatPath, "utf-8"), 10);
      if (!isNaN(ts)) {
        status.lastHeartbeat = new Date(ts);
      }
    } catch { /* file not yet created */ }
  }
}
```

#### Step 3.5: TeamRuntimeEventType 확장
**File**: `harness/teams/events.ts` (수정, line 1-24)

기존 이벤트 타입 유니온에 enforcer 이벤트 추가:

```typescript
export type TeamRuntimeEventType =
  // ... existing 24 types ...
  | "enforcer_nudge"           // TodoEnforcer가 idle worker에 독촉
  | "enforcer_kill";           // TodoEnforcer가 idle worker를 kill
```

#### Step 3.6: Team 통합
**File**: `harness/teams/team.ts` (수정)

TodoEnforcer를 Team의 실행 루프에 통합:

```typescript
// run() 메서드 내:
const abortControllers = new Map<string, AbortController>();  // in-process 모드용

const enforcer = new TodoEnforcer({
  idleThresholdMs: runtimePolicy.caps.heartbeatStalenessMs,  // 기본 30초
  nudgeIntervalMs: 15_000,
  maxNudges: 3,
  nudgeMessage: "You appear idle. Continue working on your assigned task.",
  killAfterMaxNudges: true,
}, tmuxPool ?? null, eventBus, effectiveMode === "in-process" ? abortControllers : undefined);

// ReconcileLoop heartbeat 비활성화
if (reconcileLoop) {
  reconcileLoop.config.skipHeartbeatCheck = true;
}

enforcer.start();

// 배치 실행 시 worker 등록:
for (const task of batch) {
  const workerId = `worker-${task.id}`;
  const controller = new AbortController();
  abortControllers.set(workerId, controller);
  enforcer.register(workerId, task.id, pane?.paneId);
  // ... execute worker with controller.signal ...
}

// 배치 완료 후 worker 등록 해제:
for (const task of batch) {
  enforcer.unregister(`worker-${task.id}`);
  abortControllers.delete(`worker-${task.id}`);
}

// 전체 루프 종료 시:
enforcer.stop();
```

---

### Phase 4: 신규 모듈 디렉토리 구조

```
harness/
├── agents/
│   ├── agent-types.ts          # (기존) AgentType 인터페이스
│   ├── registry.ts             # (기존) AgentTypeRegistry
│   ├── defaults.ts             # (신규) 기본 agent type 4종 + DEFAULT_CATEGORY_MAP
│   ├── matcher.ts              # (신규) AgentMatcher - weighted keyword + category→type
│   ├── formation.ts            # (신규) TeamFormation - dependency-aware 팀 편성
│   └── index.ts                # (수정) 신규 export 추가
├── execution/                  # (신규 디렉토리 — mkdir 필요)
│   ├── tmux-pool.ts            # TmuxPool - tmux session/pane 관리
│   ├── tmux-worker-runner.ts   # TmuxWorkerRunner - 파일 IPC + setInterval 폴링
│   ├── worker-entry.ts         # Worker entry script (독립 프로세스)
│   ├── todo-enforcer.ts        # TodoEnforcer - sole heartbeat authority
│   └── index.ts                # exports
├── teams/
│   ├── team.ts                 # (수정) tmux fallback + auto matching + enforcer 통합 + shouldRestartWorker
│   ├── orchestrator.ts         # (수정) category system prompt + validateAndNormalizeTasks
│   ├── worker.ts               # (변경 없음 — heartbeat은 team.ts에서 처리)
│   ├── types.ts                # (수정) TaskCategory, VALID_TASK_CATEGORIES, agentType 필드
│   ├── events.ts               # (수정) enforcer_nudge, enforcer_kill 추가
│   ├── reconcile.ts            # (수정) skipHeartbeatCheck 옵션
│   └── ...                     # 나머지 기존 파일 변경 없음
└── ...
```

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| tmux 미설치 (CI/CD, Windows, 일부 Linux) | tmux 모드 불가 | `TmuxPool.isAvailable()` 체크 → 자동 in-process fallback. 기존 동작 100% 보존 |
| WSL에서 tmux capture-pane 버퍼링 이슈 | stdout 캡처 불완전 | 파일 기반 IPC를 primary로, capture-pane은 디버깅 보조만. status 폴링은 `setInterval(500ms)` 고정 |
| tmux 버전 호환성 | pane 명령어 실패 | `tmux -V` 파싱으로 최소 1.8 확인. 미달 시 TmuxNotAvailableError |
| Heartbeat false positive (LLM 응답 대기 중) | 불필요한 nudge/kill | 별도 heartbeat interval (5초)이 LLM 호출과 무관하게 동작. `idleThresholdMs` 30초로 충분한 여유 |
| Agent type 매칭 오류 (키워드 한계) | 부적합한 agent 할당 | **LLM category 할당이 1차**, 키워드는 LLM이 category를 안 줬을 때만 fallback. `agentTypeSource` 추적으로 매칭 품질 감사 가능 |
| IPC 파일 경쟁 조건 | 데이터 손상 | `tmp + rename` atomic write 패턴을 inline 구현 (외부 의존 없음) |
| Worker entry script 오류로 pane zombie | tmux session 누수 | `TmuxPool.cleanup()`을 `process.on('exit')` + `SIGINT`/`SIGTERM`에 등록 |
| ts-node cold-start 오버헤드 | pane당 2-5초 손실 | Known limitation. 향후 pre-compile 또는 warm pool로 최적화 가능. `workerTimeoutMs`에 이미 여유 있음 (120초) |
| ReconcileLoop vs TodoEnforcer 이중 처리 | 동일 worker 이중 kill/escalate | **설계 결정**: TodoEnforcer가 sole authority. ReconcileLoop에 `skipHeartbeatCheck` 추가하여 heartbeat 검사 비활성화 |

---

## Verification Steps

### 1. Unit Tests (6개 파일)

**`tests/matcher.test.ts`**:
- LLM이 category를 줬을 때 → categoryMap에서 조회 (source: "auto", confidence: 0.9)
- LLM이 category를 안 줬을 때 → 키워드 weighted score 매칭
- 키워드 충돌 ("implement a search feature") → 최고 score category 선택 확인
- 모든 키워드 0점 → fallback type ("coder") 사용 확인
- task.agentType이 수동 지정됨 → 그대로 사용 (source: "manual") 확인
- registry에 없는 agentType → fallback 확인
- matchAll()이 batch 전체에 일관된 결과 반환 확인

**`tests/defaults.test.ts`**:
- `registerDefaultAgentTypes()`가 4개 타입 (explorer, coder, verifier, reviewer) 등록 확인
- modelOverrides가 적용되는지 확인
- DEFAULT_CATEGORY_MAP이 모든 TaskCategory를 커버하는지 확인

**`tests/formation.test.ts`**:
- 단일 타입 태스크 → slot 1개, count 정확
- 혼합 타입 → 타입별 slot 분리
- dependency가 있는 태스크 → 같은 배치에 포함 안 됨
- maxWorkers 초과 → 배치 분할

**`tests/tmux-pool.test.ts`** (mock exec):
- `isAvailable()` → `which tmux` mock으로 true/false 분기
- `allocate()` → pane 생성 명령 검증
- `release()` → kill-pane 호출 검증
- `cleanup()` → kill-session 호출 검증
- maxPanes 초과 시 에러

**`tests/todo-enforcer.test.ts`**:
- tick: active worker → heartbeat 갱신 → 상태 유지
- tick: idle worker → nudge 발행 → nudgeCount 증가
- tick: nudgeCount >= maxNudges → kill (ENFORCER_KILL_REASON 사용) → 이벤트 발행
- register/unregister → 추적 목록 정확
- stop() 후 tick 안 돌아감

**`tests/tmux-worker-runner.test.ts`** (mock TmuxPool):
- input.json 쓰기 → exec 호출 → status 폴링 → output.json 읽기 전체 흐름
- timeout 시 pane release 확인
- atomic write (tmp + rename) 패턴 확인
- status 파일 "failed" → task error 처리

### 2. Integration Tests (2개 파일)

**`tests/team-auto-matching.integration.test.ts`**:
- mock provider로 Team.run() 호출 → orchestrator가 category 포함 태스크 생성 → AgentMatcher가 agentType 할당 → worker가 해당 타입으로 실행 → 결과 수집

**`tests/team-enforcer.integration.test.ts`**:
- mock provider + 의도적으로 느린 worker → TodoEnforcer가 idle 감지 → nudge → kill → shouldRestartWorker()가 true → 재시작 → 완료

### 3. Manual Verification
- `tmux ls`로 session 생성/정리 확인
- `/tmp/ssenrah-{runId}/` 디렉토리에 IPC 파일 생성/정리 확인
- enforcer nudge 이벤트가 event bus에 기록되는지 확인
- tmux 미설치 환경에서 자동 in-process fallback 확인

---

## Implementation Order (의존성 순서)

```
Step 1.1 (types: TaskCategory, TeamTask 확장) ──────────────────┐
                                                                │
Step 1.2 (defaults: 기본 agent type 등록) ─────┐                │
Step 1.3 (matcher: AgentMatcher) ──────────────┤                │
Step 1.5 (formation: TeamFormation) ───────────┘                │
         │                                                      │
Step 1.4 (orchestrator: prompt + validate + matcher 호출) ◄─────┘
         │
         │ (Phase 1 완료. 여기서 in-process 모드로 검증 가능)
         │
Step 2.1 (tmux-pool) ─────────────────┐
Step 2.2 (tmux-worker-runner + IPC) ───┤
Step 2.3 (worker-entry script) ────────┘
         │
Step 2.4 (team.ts: execution mode 분기) ◄──┘
         │
Step 3.5 (events: enforcer 이벤트 타입) ───┐
Step 3.1 (todo-enforcer) ─────────────────┤
Step 3.2 (shouldRestartWorker 수정) ───────┤
Step 3.3 (reconcile: skipHeartbeatCheck) ──┤
Step 3.4 (worker: heartbeat 인터벌) ───────┘
         │
Step 3.6 (team.ts: enforcer 통합) ◄───────┘
         │
Tests (unit 6개 + integration 2개) ◄───────┘
```

**예상 신규 파일**: 9개 (소스 6 + index 2 + execution 디렉토리)
**예상 수정 파일**: 6개 (types.ts, orchestrator.ts, team.ts, events.ts, reconcile.ts, agents/index.ts)
**예상 테스트 파일**: 8개 (unit 6 + integration 2)

---

## Changelog (v2 — Architect/Critic 피드백 반영)

1. **Step 1.4b 추가**: `validateAndNormalizeTasks()`에서 `category` 필드 파싱/보존 명시. 유효하지 않은 값은 조용히 무시
2. **ReconcileLoop vs TodoEnforcer 소유권 해결**: TodoEnforcer가 sole heartbeat authority. ReconcileLoop에 `skipHeartbeatCheck` 옵션 추가 (Step 3.3)
3. **`shouldRestartWorker()` 수정 명시**: `ENFORCER_KILL_REASON` 상수 도입, error string 매칭 추가 (Step 3.2)
4. **Phantom 파일 참조 제거**: `harness/io/atomic.ts` 참조 삭제. atomic write를 inline `tmp + rename` 패턴으로 직접 구현
5. **`TeamRuntimeEventType` 확장 명시**: `enforcer_nudge`, `enforcer_kill` 추가 (Step 3.5)
6. **키워드 충돌 해결 전략 명시**: weighted score 방식. 각 category별 키워드에 가중치 부여, 합산 최고점 선택 (Step 1.3)
7. **`fs.watch` 금지**: WSL 비호환으로 `setInterval(500ms)` 폴링만 사용 (Step 2.2)
8. **ts-node cold-start 오버헤드 문서화**: known limitation으로 Risks 테이블에 추가. 향후 최적화 경로 명시
9. **`harness/execution/` 디렉토리 생성 명시**: Phase 2 전제조건으로 추가
10. **tmux 모드에서 mailbox 한계 명시**: in-process mailbox는 프로세스 경계 불가. tmux 모드 nudge는 sendKeys 전용
11. **`shouldRestartWorker` 시그니처 수정**: `(error: unknown)` → `(task: TeamTask)` — 실제 코드와 일치 (team.ts:63)
12. **ReconcileLoop `skipHeartbeatCheck` construction-time 주입**: 런타임 mutation 대신 constructor input으로 변경
13. **Heartbeat을 Team-level로 이동**: `worker.ts` 수정 불필요. `Team.run()`의 배치 루프에서 `setInterval`로 enforcer.heartbeat() 호출. 계층 분리 유지
