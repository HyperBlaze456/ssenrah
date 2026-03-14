package application

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/HyperBlaze456/ssenrah/harness/domain/agent"
	"github.com/HyperBlaze456/ssenrah/harness/domain/conversation"
	"github.com/HyperBlaze456/ssenrah/harness/domain/event"
	"github.com/HyperBlaze456/ssenrah/harness/domain/policy"
	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
	"github.com/HyperBlaze456/ssenrah/harness/domain/task"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/logging"
	"github.com/google/uuid"
)

// WorkerStatus indicates the lifecycle state of a worker.
type WorkerStatus int

const (
	WorkerIdle    WorkerStatus = iota
	WorkerRunning WorkerStatus = iota
	WorkerDone    WorkerStatus = iota
	WorkerFailed  WorkerStatus = iota
)

// Worker represents a single agent executing a task.
type Worker struct {
	ID        string
	TaskID    string
	AgentType string
	Status    WorkerStatus
	StartedAt time.Time
	cancel    context.CancelFunc
}

// WorkerPool manages concurrent agent execution for team tasks.
type WorkerPool struct {
	maxWorkers   int
	provider     provider.LLMProvider
	fullRegistry *tool.Registry
	policyEngine policy.PolicyEngine
	profiles     map[string]policy.PolicyProfile
	agentTypes   map[string]agent.AgentType
	eventLogger  event.EventLogger
	taskTimeout  time.Duration

	// mu protects workers map
	mu      sync.Mutex
	workers map[string]*Worker // workerID → Worker
}

// NewWorkerPool creates a new WorkerPool.
func NewWorkerPool(
	maxWorkers int,
	prov provider.LLMProvider,
	fullRegistry *tool.Registry,
	engine policy.PolicyEngine,
	profiles map[string]policy.PolicyProfile,
	agentTypes map[string]agent.AgentType,
	logger event.EventLogger,
	taskTimeout time.Duration,
) *WorkerPool {
	return &WorkerPool{
		maxWorkers:   maxWorkers,
		provider:     prov,
		fullRegistry: fullRegistry,
		policyEngine: engine,
		profiles:     profiles,
		agentTypes:   agentTypes,
		eventLogger:  logger,
		taskTimeout:  taskTimeout,
		workers:      make(map[string]*Worker),
	}
}

// ExecuteBatch takes ready tasks from the graph and runs them concurrently up to maxWorkers.
// It returns the updated tasks after execution.
func (p *WorkerPool) ExecuteBatch(ctx context.Context, tasks []task.Task, graph *task.TaskGraph) []task.Task {
	if len(tasks) == 0 {
		return nil
	}

	// Limit concurrency to maxWorkers.
	limit := p.maxWorkers
	if len(tasks) < limit {
		limit = len(tasks)
	}
	batch := tasks[:limit]

	results := make([]task.Task, len(batch))
	var wg sync.WaitGroup

	for i, t := range batch {
		wg.Add(1)
		go func(idx int, tsk task.Task) {
			defer wg.Done()
			taskCtx, cancel := context.WithTimeout(ctx, p.taskTimeout)
			defer cancel()
			results[idx] = p.executeTask(taskCtx, tsk, graph)
		}(i, t)
	}

	wg.Wait()
	return results
}

// executeTask runs a single task using a fresh AgentService and updates the graph.
func (p *WorkerPool) executeTask(ctx context.Context, t task.Task, graph *task.TaskGraph) task.Task {
	workerID := uuid.New().String()

	// Resolve agent type — fall back to "default" if not found.
	agentTypeName := t.AgentType
	at, ok := p.agentTypes[agentTypeName]
	if !ok {
		if def, defOK := p.agentTypes["default"]; defOK {
			at = def
			agentTypeName = "default"
		} else {
			// No default agent type — construct a minimal one.
			at = agent.AgentType{
				Name:         "default",
				Model:        "",
				SystemPrompt: "You are a helpful assistant.",
				MaxTurns:     10,
			}
			agentTypeName = "default"
		}
	}

	// Register worker.
	taskCtx, cancel := context.WithCancel(ctx)
	worker := &Worker{
		ID:        workerID,
		TaskID:    t.ID,
		AgentType: agentTypeName,
		Status:    WorkerRunning,
		StartedAt: time.Now(),
		cancel:    cancel,
	}
	p.mu.Lock()
	p.workers[workerID] = worker
	p.mu.Unlock()

	defer func() {
		cancel()
		p.mu.Lock()
		delete(p.workers, workerID)
		p.mu.Unlock()
	}()

	// Log worker started.
	p.logEvent(logging.NewWorkerEvent(event.EventWorkerStarted, workerID, t.ID))

	// Claim task.
	if err := graph.Claim(t.ID, workerID); err != nil {
		p.logEvent(logging.NewTaskEvent(event.EventTaskFailed, t.ID, t.Description, agentTypeName))
		worker.Status = WorkerFailed
		_ = graph.Fail(t.ID, fmt.Sprintf("claim failed: %v", err))
		updated, _ := graph.Get(t.ID)
		if updated != nil {
			return *updated
		}
		return t
	}

	// Log task assigned.
	p.logEvent(logging.NewTaskEvent(event.EventTaskAssigned, t.ID, t.Description, agentTypeName))

	// Build filtered registry for this agent type.
	filteredReg := infrastructure.BuildRegistryForAgentType(at, p.fullRegistry)

	// Resolve policy profile.
	profile, ok := p.profiles[at.PolicyTier]
	if !ok {
		// Fall back to first available profile or an empty allow-all profile.
		if len(p.profiles) > 0 {
			for _, v := range p.profiles {
				profile = v
				break
			}
		} else {
			profile = policy.PolicyProfile{
				Name:          "default",
				DefaultAction: policy.Allow,
				ToolRules:     map[string]policy.ToolRule{},
			}
		}
	}

	// Create fresh conversation and agent service.
	conv := conversation.New()
	svc := NewAgentService(conv, p.provider, filteredReg, at.SystemPrompt, p.policyEngine, profile, p.eventLogger)
	svc.ApplyAgentType(at, profile, filteredReg)

	// Run the agent loop — collect events internally; auto-approve all tool calls
	// (workers run autonomously; approval is handled at policy layer, not UI).
	eventCh := make(chan AgentEvent, 64)
	var finalContent string
	var runErr error

	var readerWg sync.WaitGroup
	readerWg.Add(1)
	go func() {
		defer readerWg.Done()
		for ev := range eventCh {
			switch typed := ev.(type) {
			case EventDone:
				finalContent = typed.FinalMessage.Content
			case EventError:
				runErr = typed.Err
			case EventApprovalNeeded:
				// Workers auto-approve based on policy; if AwaitUser slips through,
				// approve it so the loop doesn't block.
				typed.ResponseCh <- ApprovalResponse{Approved: true}
			}
		}
	}()

	userMsg := shared.NewMessage(shared.RoleUser, t.Description)
	svc.Run(taskCtx, userMsg, eventCh)
	readerWg.Wait()

	// Determine outcome.
	if runErr != nil || taskCtx.Err() != nil {
		errMsg := ""
		if runErr != nil {
			errMsg = runErr.Error()
		} else {
			errMsg = taskCtx.Err().Error()
		}
		worker.Status = WorkerFailed
		p.logEvent(logging.NewTaskEvent(event.EventTaskFailed, t.ID, t.Description, agentTypeName))
		_ = graph.Fail(t.ID, errMsg)
	} else {
		worker.Status = WorkerDone
		p.logEvent(logging.NewTaskEvent(event.EventTaskCompleted, t.ID, t.Description, agentTypeName))
		_ = graph.Complete(t.ID, task.TaskResult{
			Content:  finalContent,
			Verified: false,
		})
	}

	updated, ok := graph.Get(t.ID)
	if ok {
		return *updated
	}
	return t
}

// ActiveWorkers returns a snapshot of currently active workers.
func (p *WorkerPool) ActiveWorkers() []Worker {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]Worker, 0, len(p.workers))
	for _, w := range p.workers {
		out = append(out, *w)
	}
	return out
}

// Cancel cancels a specific worker by ID.
func (p *WorkerPool) Cancel(workerID string) {
	p.mu.Lock()
	w, ok := p.workers[workerID]
	p.mu.Unlock()
	if ok && w.cancel != nil {
		w.cancel()
	}
}

// CancelAll cancels all active workers.
func (p *WorkerPool) CancelAll() {
	p.mu.Lock()
	ids := make([]string, 0, len(p.workers))
	for id := range p.workers {
		ids = append(ids, id)
	}
	p.mu.Unlock()
	for _, id := range ids {
		p.Cancel(id)
	}
}

// logEvent logs an event, silently ignoring errors.
func (p *WorkerPool) logEvent(ev event.Event) {
	if p.eventLogger != nil {
		_ = p.eventLogger.Log(ev)
	}
}
