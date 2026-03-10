package config

// DefaultConfig returns the default configuration.
func DefaultConfig() AppConfig {
	return AppConfig{
		Model:       "dummy-v1",
		Provider:    "dummy",
		Theme:       "dark",
		SidebarOpen: true,
	}
}
