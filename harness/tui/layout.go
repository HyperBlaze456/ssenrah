package tui

// LayoutMetrics holds computed dimensions for TUI components.
type LayoutMetrics struct {
	ChatWidth       int
	ChatHeight      int
	SidebarWidth    int
	SidebarHeight   int
	InputHeight     int
	StatusBarHeight int
	CompactMode     bool
	TooSmall        bool
}

const (
	sidebarWidth    = 33
	wideBreakpoint  = 120
	minWidth        = 80
	minHeight       = 24
	inputHeight     = 3
	statusBarHeight = 1
)

// ComputeLayout calculates layout dimensions based on terminal size and sidebar state.
func ComputeLayout(width, height int, sidebarOpen bool) LayoutMetrics {
	if width < minWidth || height < minHeight {
		return LayoutMetrics{TooSmall: true}
	}

	compact := width < wideBreakpoint
	m := LayoutMetrics{
		InputHeight:     inputHeight,
		StatusBarHeight: statusBarHeight,
		CompactMode:     compact,
	}

	// Available height for chat = total - input - statusbar - borders
	availHeight := height - inputHeight - statusBarHeight - 2
	if compact {
		availHeight -= 1 // compact top bar takes 1 line
	}

	if sidebarOpen && !compact {
		m.SidebarWidth = sidebarWidth
		m.ChatWidth = width - sidebarWidth - 1 // 1 for border
		m.SidebarHeight = availHeight
	} else {
		m.SidebarWidth = 0
		m.ChatWidth = width
	}

	m.ChatHeight = availHeight
	return m
}
