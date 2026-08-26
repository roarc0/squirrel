package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"

	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

const maxAIContextSize int32 = 1 << 20

// probeServerContext tries to read the actual n_ctx from a running llama-server /props endpoint.
// Returns 0 if not available (non-llama-server or unreachable).
func probeServerContext(ctx context.Context, endpoint string) int {
	base := strings.TrimSuffix(strings.TrimSuffix(endpoint, "/v1"), "/")
	probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, base+"/props", nil)
	if err != nil {
		return 0
	}
	res, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		return 0
	}
	defer res.Body.Close()
	var props struct {
		NCtx int `json:"n_ctx"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&props) == nil && props.NCtx > 0 {
		return props.NCtx
	}
	return 0
}

func (s *Server) StreamChat(ctx context.Context, req *connect.Request[portv1.StreamChatRequest], stream *connect.ServerStream[portv1.StreamChatResponse]) error {
	msg := req.Msg
	requestedEndpoint := strings.TrimRight(strings.TrimSpace(msg.Endpoint), "/")
	endpoint := requestedEndpoint
	if endpoint == "" {
		endpoint = strings.TrimRight(s.config.AIEndpoint, "/")
	}
	parsedEndpoint, err := validateHTTPSOrLoopbackURL(endpoint)
	if len(endpoint) > 2048 || err != nil || parsedEndpoint.RawQuery != "" || parsedEndpoint.Fragment != "" {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid AI endpoint"))
	}
	endpoint = strings.TrimRight(parsedEndpoint.String(), "/")
	model := strings.TrimSpace(msg.Model)
	if model == "" {
		model = s.config.AIModel
	}
	if model == "" || len(model) > 256 {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid AI model name"))
	}

	contextSize := req.Msg.ContextSize
	if contextSize <= 0 {
		contextSize = int32(s.config.AIContextSize)
	}
	if contextSize <= 0 {
		contextSize = 16384
	}
	if contextSize > maxAIContextSize {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("AI context size is too large"))
	}

	// Probe the actual server context window — overrides user setting when server is smaller.
	// This makes the context budget accurate regardless of what the user configured.
	if actualCtx := probeServerContext(ctx, endpoint); actualCtx > 0 && int32(actualCtx) < contextSize {
		slog.InfoContext(ctx, "Server context smaller than configured — using server limit", "server_n_ctx", actualCtx, "configured", contextSize)
		contextSize = int32(actualCtx)
	}

	// Fetch tools first so we can account for their token cost in budget calculations.
	var tools []map[string]interface{}
	if s.mcpHandler != nil {
		tools = s.mcpHandler.OpenAITools()
	}
	toolTokens := 0
	if len(tools) > 0 {
		if toolsJSON, err2 := json.Marshal(tools); err2 == nil {
			toolTokens = len(toolsJSON) / 3
		}
	}

	// Total prompt budget: context minus output headroom and tool schema overhead.
	totalPromptBudget := int(contextSize) - 500 - toolTokens
	if totalPromptBudget < 400 {
		totalPromptBudget = 400
	}

	basePrompt := s.config.AISystemPrompt
	baseTokens := len(basePrompt) / 3

	systemPrompt := basePrompt
	if msg.PortfolioContextJson != "" {
		// Reserve 200 tokens for last user message turn.
		portfolioBudgetChars := (totalPromptBudget - baseTokens - 200) * 3
		portfolioJSON := msg.PortfolioContextJson
		if portfolioBudgetChars > 0 && len(portfolioJSON) > portfolioBudgetChars {
			portfolioJSON = portfolioJSON[:portfolioBudgetChars] + "\n... (truncated to fit context)"
		}
		if portfolioBudgetChars > 0 {
			systemPrompt += fmt.Sprintf("\n\nReal-time Live Portfolio State:\n```json\n%s\n```", portfolioJSON)
		}
	}

	if !strings.Contains(strings.ToLower(systemPrompt), "grain of salt") {
		systemPrompt += "\n\nDISCLAIMER WARNING: Nothing provided by this AI consultant constitutes financial advice. All recommendations and suggestions are to be taken with a grain of salt."
	}

	var conversation []map[string]interface{}
	conversation = append(conversation, map[string]interface{}{
		"role":    "system",
		"content": systemPrompt,
	})

	systemTokens := len(systemPrompt) / 3
	maxHistoryTokens := totalPromptBudget - systemTokens
	if maxHistoryTokens < 150 {
		maxHistoryTokens = 150
	}

	for _, m := range msg.Messages {
		if m.Role != "user" && m.Role != "assistant" {
			continue
		}
		if strings.TrimSpace(m.Content) == "" {
			continue
		}
		conversation = append(conversation, map[string]interface{}{
			"role":    m.Role,
			"content": m.Content,
		})
	}

	estimateTokens := func(turns []map[string]interface{}) int {
		totalChars := 0
		for _, turn := range turns {
			if content, ok := turn["content"].(string); ok {
				totalChars += len(content)
			}
			if toolCalls, ok := turn["tool_calls"]; ok {
				b, _ := json.Marshal(toolCalls)
				totalChars += len(b)
			}
		}
		return totalChars / 3
	}

	// Prune older history turns so conversation[1:] fits within maxHistoryTokens.
	for len(conversation) > 2 && estimateTokens(conversation[1:]) > maxHistoryTokens {
		conversation = append(conversation[:1], conversation[2:]...)
	}
	// Hard-truncate a single oversized user message if still exceeding budget.
	if len(conversation) > 1 && estimateTokens(conversation[1:]) > maxHistoryTokens {
		for i := 1; i < len(conversation); i++ {
			if content, ok := conversation[i]["content"].(string); ok && len(content) > maxHistoryTokens*4 {
				conversation[i]["content"] = content[:maxHistoryTokens*4] + "\n... (truncated for context limit)"
			}
		}
	}

	payload := map[string]interface{}{
		"model":              model,
		"messages":           conversation,
		"temperature":        0.6,
		"stream":             true,
		"max_tokens":         2048,
		"repeat_penalty":     1.15,
		"repetition_penalty": 1.15,
		"presence_penalty":   0.1,
		"num_ctx":            contextSize,
		"n_ctx":              contextSize,
		"options": map[string]interface{}{
			"num_ctx":        contextSize,
			"repeat_penalty": 1.15,
		},
	}
	if len(tools) > 0 {
		payload["tools"] = tools
		payload["tool_choice"] = "auto"
	}

	if err := stream.Send(&portv1.StreamChatResponse{ActualNCtx: contextSize}); err != nil {
		return err
	}
	apiKey := s.aiAPIKey(msg.ApiKey, requestedEndpoint, endpoint)
	return s.executeStreamChatPayload(ctx, endpoint, apiKey, payload, conversation, stream, maxHistoryTokens, estimateTokens, 0)
}

func (s *Server) aiAPIKey(requestKey, requestedEndpoint, resolvedEndpoint string) string {
	if requestKey != "" {
		return requestKey
	}
	configuredEndpoint := strings.TrimRight(strings.TrimSpace(s.config.AIEndpoint), "/")
	if requestedEndpoint == "" || resolvedEndpoint == configuredEndpoint {
		return s.config.AIAPIKey
	}
	return ""
}

func (s *Server) executeStreamChatPayload(
	ctx context.Context,
	endpoint string,
	apiKey string,
	payload map[string]interface{},
	conversation []map[string]interface{},
	stream *connect.ServerStream[portv1.StreamChatResponse],
	maxPromptTokens int,
	estimateTokens func([]map[string]interface{}) int,
	toolRound int,
) error {
	url := fmt.Sprintf("%s/chat/completions", endpoint)
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("marshal chat payload failed: %w", err))
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("create chat stream request failed: %w", err))
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	}

	client := &http.Client{Timeout: 0}
	res, err := client.Do(httpReq)
	if err != nil {
		return connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to AI server at %s: %w", url, err))
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		errBody, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))

		// On context overflow errors: extract the server's actual n_ctx, truncate system message, retry once.
		var errResp struct {
			Error struct {
				Type string `json:"type"`
				NCtx int    `json:"n_ctx"`
			} `json:"error"`
		}
		if json.Unmarshal(errBody, &errResp) == nil && errResp.Error.Type == "exceed_context_size_error" && errResp.Error.NCtx > 0 {
			actualCtx := errResp.Error.NCtx

			// Small context (≤8192): tools alone are too expensive — drop them unconditionally.
			if actualCtx <= 8192 {
				delete(payload, "tools")
			}

			totalBudget := actualCtx - 500
			if totalBudget < 300 {
				totalBudget = 300
			}
			msgReserve := 200 // tokens always reserved for the last user turn
			sysBudget := totalBudget - msgReserve

			if msgs, ok := payload["messages"].([]map[string]interface{}); ok && len(msgs) > 0 {
				// Truncate system message to sysBudget using conservative /3 estimate.
				if content, ok := msgs[0]["content"].(string); ok && len(content)/3 > sysBudget {
					msgs[0]["content"] = content[:sysBudget*3] + "\n... (truncated: server context is " + fmt.Sprintf("%d", actualCtx) + " tokens)"
				}
				sysTokens := len(msgs[0]["content"].(string)) / 3
				histBudget := totalBudget - sysTokens
				if histBudget < msgReserve {
					histBudget = msgReserve
				}
				// Prune older history, always keep the last user message (msgs[len-1]).
				for len(msgs) > 2 && estimateTokens(msgs[1:]) > histBudget {
					msgs = append(msgs[:1], msgs[2:]...)
				}
				payload["messages"] = msgs
				conversation = msgs
			}
			bodyBytes2, err := json.Marshal(payload)
			if err != nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("marshal trimmed chat payload: %w", err))
			}
			httpReq2, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes2))
			if err != nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("create chat retry request: %w", err))
			}
			httpReq2.Header.Set("Content-Type", "application/json")
			if apiKey != "" {
				httpReq2.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
			}
			res2, err2 := (&http.Client{Timeout: 0}).Do(httpReq2)
			if err2 != nil {
				return connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to AI server on retry: %w", err2))
			}
			defer res2.Body.Close()
			if res2.StatusCode >= 400 {
				errBody2, _ := io.ReadAll(io.LimitReader(res2.Body, 64<<10))
				return connect.NewError(connect.CodeInternal, fmt.Errorf("AI provider HTTP %d (retry after context trim): %s", res2.StatusCode, string(errBody2)))
			}
			res = res2
		} else {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("AI provider HTTP %d: %s", res.StatusCode, string(errBody)))
		}
	}

	type toolCallDelta struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	}

	var pendingToolCalls []toolCallDelta
	toolCallMap := make(map[int]*toolCallDelta)

	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		dataStr := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if dataStr == "[DONE]" {
			break
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}

		if err := json.Unmarshal([]byte(dataStr), &chunk); err == nil && len(chunk.Choices) > 0 {
			delta := chunk.Choices[0].Delta
			if delta.Content != "" {
				if err := stream.Send(&portv1.StreamChatResponse{
					DeltaText: delta.Content,
				}); err != nil {
					return err
				}
			}

			for _, tc := range delta.ToolCalls {
				idx := tc.Index
				if _, exists := toolCallMap[idx]; !exists {
					toolCallMap[idx] = &toolCallDelta{}
				}
				if tc.ID != "" {
					toolCallMap[idx].ID = tc.ID
				}
				if tc.Function.Name != "" {
					toolCallMap[idx].Function.Name += tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					toolCallMap[idx].Function.Arguments += tc.Function.Arguments
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return connect.NewError(connect.CodeUnavailable, fmt.Errorf("read AI stream: %w", err))
	}

	for i := 0; i < len(toolCallMap); i++ {
		if tc, ok := toolCallMap[i]; ok && tc.Function.Name != "" {
			pendingToolCalls = append(pendingToolCalls, *tc)
		}
	}

	if len(pendingToolCalls) > 0 && s.mcpHandler != nil {
		if toolRound >= 8 {
			return connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("AI tool-call round limit reached"))
		}
		var toolCallPayloads []map[string]interface{}
		var toolResults []map[string]interface{}

		for _, tc := range pendingToolCalls {
			var args map[string]interface{}
			resultJSON := ""
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil || args == nil {
				resultJSON = `{"error":"invalid tool arguments"}`
			} else if resultJSON, err = s.mcpHandler.ExecuteTool(ctx, tc.Function.Name, args); err != nil {
				resultJSON = fmt.Sprintf(`{"error": %q}`, err.Error())
			}

			if err := stream.Send(&portv1.StreamChatResponse{
				IsMcpToolCall:  true,
				ToolName:       tc.Function.Name,
				ToolArgsJson:   tc.Function.Arguments,
				ToolResultJson: resultJSON,
			}); err != nil {
				return err
			}

			toolCallPayloads = append(toolCallPayloads, map[string]interface{}{
				"id":   tc.ID,
				"type": "function",
				"function": map[string]interface{}{
					"name":      tc.Function.Name,
					"arguments": tc.Function.Arguments,
				},
			})

			llmResultJSON := resultJSON
			if len(llmResultJSON) > 3000 {
				llmResultJSON = llmResultJSON[:3000] + "\n... (truncated tool response)"
			}

			toolResults = append(toolResults, map[string]interface{}{
				"role":         "tool",
				"tool_call_id": tc.ID,
				"content":      llmResultJSON,
			})
		}

		conversation = append(conversation, map[string]interface{}{
			"role":       "assistant",
			"tool_calls": toolCallPayloads,
		})
		conversation = append(conversation, toolResults...)

		for len(conversation) > 2 && estimateTokens(conversation) > maxPromptTokens {
			conversation = append(conversation[:1], conversation[2:]...)
		}

		nextPayload := map[string]interface{}{
			"model":       payload["model"],
			"messages":    conversation,
			"temperature": 0.3,
			"stream":      true,
		}
		for _, k := range []string{"tools", "num_ctx", "n_ctx", "options", "max_tokens", "repeat_penalty", "repetition_penalty", "presence_penalty"} {
			if v, ok := payload[k]; ok {
				nextPayload[k] = v
			}
		}

		return s.executeStreamChatPayload(ctx, endpoint, apiKey, nextPayload, conversation, stream, maxPromptTokens, estimateTokens, toolRound+1)
	}

	return stream.Send(&portv1.StreamChatResponse{Done: true})
}
