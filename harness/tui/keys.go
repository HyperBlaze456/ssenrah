package tui

import "github.com/charmbracelet/bubbles/key"

type keyMap struct {
	Send      key.Binding
	Tab       key.Binding
	Cancel    key.Binding
	Quit      key.Binding
	QuitAlt   key.Binding
	ClearChat key.Binding
}

func defaultKeyMap() keyMap {
	return keyMap{
		Send:      key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "send")),
		Tab:       key.NewBinding(key.WithKeys("tab"), key.WithHelp("tab", "sidebar")),
		Cancel:    key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "cancel")),
		Quit:      key.NewBinding(key.WithKeys("ctrl+c"), key.WithHelp("ctrl+c", "quit")),
		QuitAlt:   key.NewBinding(key.WithKeys("ctrl+q"), key.WithHelp("ctrl+q", "quit")),
		ClearChat: key.NewBinding(key.WithKeys("ctrl+l"), key.WithHelp("ctrl+l", "clear")),
	}
}
