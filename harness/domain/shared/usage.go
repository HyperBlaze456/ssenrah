package shared

// Usage tracks token consumption for a provider response.
type Usage struct {
	InputTokens  int
	OutputTokens int
}

// TotalTokens returns the sum of input and output tokens.
func (u Usage) TotalTokens() int {
	return u.InputTokens + u.OutputTokens
}

// EstimateCost calculates the estimated cost based on per-token prices.
func (u Usage) EstimateCost(inputPrice, outputPrice float64) float64 {
	return float64(u.InputTokens)*inputPrice + float64(u.OutputTokens)*outputPrice
}
