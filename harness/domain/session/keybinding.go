package session

// KeyBinding maps a key to an action with a human-readable description.
type KeyBinding struct {
	Key         string
	Action      string
	Description string
}

// KeyBindingRegistry maintains an ordered collection of key bindings.
type KeyBindingRegistry struct {
	bindings []KeyBinding
}

// NewKeyBindingRegistry creates an empty KeyBindingRegistry.
func NewKeyBindingRegistry() *KeyBindingRegistry {
	return &KeyBindingRegistry{
		bindings: make([]KeyBinding, 0),
	}
}

// Register adds a key binding to the registry.
func (r *KeyBindingRegistry) Register(kb KeyBinding) {
	r.bindings = append(r.bindings, kb)
}

// All returns a copy of all registered key bindings.
func (r *KeyBindingRegistry) All() []KeyBinding {
	cp := make([]KeyBinding, len(r.bindings))
	copy(cp, r.bindings)
	return cp
}

// ForKey returns the first key binding matching the given key, or nil if not found.
func (r *KeyBindingRegistry) ForKey(key string) *KeyBinding {
	for _, kb := range r.bindings {
		if kb.Key == key {
			return &kb
		}
	}
	return nil
}
