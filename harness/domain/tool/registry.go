package tool

import (
	"fmt"
	"sort"
	"sync"
)

// Registry is a thread-safe store of named tools.
type Registry struct {
	mu    sync.RWMutex
	tools map[string]Tool
}

// NewRegistry returns an empty Registry.
func NewRegistry() *Registry { return &Registry{tools: make(map[string]Tool)} }

// Register adds a tool to the registry. Returns an error if a tool with the
// same name is already registered.
func (r *Registry) Register(t Tool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.tools[t.Name()]; exists {
		return fmt.Errorf("tool already registered: %s", t.Name())
	}
	r.tools[t.Name()] = t
	return nil
}

// Get retrieves a tool by name. The second return value is false when the tool
// is not found.
func (r *Registry) Get(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tools[name]
	return t, ok
}

// List returns all registered tools sorted by name.
func (r *Registry) List() []Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	list := make([]Tool, 0, len(r.tools))
	for _, t := range r.tools {
		list = append(list, t)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name() < list[j].Name() })
	return list
}

// Count returns the number of registered tools.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.tools)
}
