package tui

import "github.com/charmbracelet/lipgloss"

type theme struct {
	UserMessage      lipgloss.Style
	AssistantMessage lipgloss.Style
	SystemMessage    lipgloss.Style
	ErrorMessage     lipgloss.Style
	CodeBlock        lipgloss.Style
	Sidebar          lipgloss.Style
	SidebarTitle     lipgloss.Style
	StatusBar        lipgloss.Style
	Input            lipgloss.Style
	InputInfo        lipgloss.Style
	Header           lipgloss.Style
	Border           lipgloss.Style
	Muted            lipgloss.Style
	UserBadge        lipgloss.Style
	AssistantBadge   lipgloss.Style
}

func defaultTheme() theme {
	return theme{
		UserMessage:      lipgloss.NewStyle().Foreground(lipgloss.Color("6")),
		AssistantMessage: lipgloss.NewStyle().Foreground(lipgloss.Color("7")),
		SystemMessage:    lipgloss.NewStyle().Foreground(lipgloss.Color("8")),
		ErrorMessage:     lipgloss.NewStyle().Foreground(lipgloss.Color("1")),
		CodeBlock:        lipgloss.NewStyle().Background(lipgloss.Color("236")),
		Sidebar:          lipgloss.NewStyle().Foreground(lipgloss.Color("8")),
		SidebarTitle:     lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("5")),
		StatusBar:        lipgloss.NewStyle().Reverse(true).Padding(0, 1),
		Input:            lipgloss.NewStyle().BorderStyle(lipgloss.NormalBorder()).BorderTop(true).BorderForeground(lipgloss.Color("8")),
		InputInfo:        lipgloss.NewStyle().Foreground(lipgloss.Color("8")),
		Header:           lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("5")),
		Border:           lipgloss.NewStyle().BorderStyle(lipgloss.NormalBorder()).BorderForeground(lipgloss.Color("8")),
		Muted:            lipgloss.NewStyle().Foreground(lipgloss.Color("8")),
		UserBadge:        lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("6")).SetString("▶ You"),
		AssistantBadge:   lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("5")).SetString("◀ Assistant"),
	}
}
