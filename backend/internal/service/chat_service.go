package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"

	"github.com/roarc0/squirrel/backend/internal/auth"
	"github.com/roarc0/squirrel/backend/internal/store"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

type chatBroadcaster struct {
	mu          sync.Mutex
	subscribers map[chan *portv1.StreamChatResponse]struct{}
	history     []*portv1.StreamChatResponse
	done        bool
}

func newBroadcaster() *chatBroadcaster {
	return &chatBroadcaster{
		subscribers: make(map[chan *portv1.StreamChatResponse]struct{}),
	}
}

func (b *chatBroadcaster) Subscribe() (chan *portv1.StreamChatResponse, []*portv1.StreamChatResponse, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	ch := make(chan *portv1.StreamChatResponse, 256)
	b.subscribers[ch] = struct{}{}

	historyCopy := make([]*portv1.StreamChatResponse, len(b.history))
	copy(historyCopy, b.history)

	return ch, historyCopy, b.done
}

func (b *chatBroadcaster) Unsubscribe(ch chan *portv1.StreamChatResponse) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.subscribers, ch)
	close(ch)
}

func (b *chatBroadcaster) Broadcast(resp *portv1.StreamChatResponse) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.history = append(b.history, resp)
	if resp.Done {
		b.done = true
	}

	for ch := range b.subscribers {
		select {
		case ch <- resp:
		default:
		}
	}
}

type activeChatJob struct {
	SessionID   string
	UserID      string
	Ctx         context.Context
	Cancel      context.CancelFunc
	Broadcaster *chatBroadcaster
	ActualNCtx  atomic.Int32
}

type chatJobRegistry struct {
	mu   sync.Mutex
	jobs map[chatJobKey]*activeChatJob
}

type chatJobKey struct {
	UserID    string
	SessionID string
}

var globalChatJobs = &chatJobRegistry{
	jobs: make(map[chatJobKey]*activeChatJob),
}

const (
	maxAIContextSize        int32 = 1 << 20
	maxChatSessionIDSize          = 128
	maxChatTitleSize              = 200
	maxChatMessages               = 200
	maxChatMessageSize            = 128 << 10
	maxChatHistorySize            = 2 << 20
	maxPortfolioContextSize       = 1 << 20
)

func validateChatSessionID(id string) error {
	if id == "" || len(id) > maxChatSessionIDSize {
		return errors.New("session id must be between 1 and 128 characters")
	}
	for i := range len(id) {
		c := id[i]
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '-' && c != '_' && c != '.' {
			return errors.New("session id may contain only letters, numbers, dots, dashes, and underscores")
		}
	}
	return nil
}

func validateStreamChatRequest(msg *portv1.StreamChatRequest) error {
	if len(msg.Provider) > 32 || len(msg.Endpoint) > 2048 || len(msg.Model) > 256 || len(msg.ApiKey) > 16<<10 {
		return errors.New("AI provider settings exceed the supported size")
	}
	if len(msg.Messages) > maxChatMessages {
		return fmt.Errorf("chat history exceeds %d messages", maxChatMessages)
	}
	if len(msg.PortfolioContextJson) > maxPortfolioContextSize {
		return errors.New("portfolio context exceeds 1 MiB")
	}
	total := 0
	for _, message := range msg.Messages {
		if message == nil {
			return errors.New("chat history contains an empty message")
		}
		if message.Role != "user" && message.Role != "assistant" {
			return fmt.Errorf("unsupported chat role %q", message.Role)
		}
		if len(message.Content) > maxChatMessageSize {
			return errors.New("chat message exceeds 128 KiB")
		}
		total += len(message.Content)
	}
	if total > maxChatHistorySize {
		return errors.New("chat history exceeds 2 MiB")
	}
	return nil
}

func backgroundChatContext(requestCtx context.Context) (context.Context, context.CancelFunc) {
	ctx := context.Background()
	if user, ok := auth.UserFromContext(requestCtx); ok {
		ctx = auth.WithUser(ctx, user)
	}
	return context.WithCancel(ctx)
}

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
	sessionID := strings.TrimSpace(msg.SessionId)
	if sessionID == "" {
		sessionID = fmt.Sprintf("chat-%d", time.Now().UnixNano())
	}
	if err := validateChatSessionID(sessionID); err != nil {
		return connect.NewError(connect.CodeInvalidArgument, err)
	}
	if err := validateStreamChatRequest(msg); err != nil {
		return connect.NewError(connect.CodeInvalidArgument, err)
	}
	userID := auth.UserIDOrEmpty(ctx)
	key := chatJobKey{UserID: userID, SessionID: sessionID}

	globalChatJobs.mu.Lock()
	job, exists := globalChatJobs.jobs[key]
	if !exists {
		jobCtx, cancel := backgroundChatContext(ctx)
		job = &activeChatJob{
			SessionID:   sessionID,
			UserID:      userID,
			Ctx:         jobCtx,
			Cancel:      cancel,
			Broadcaster: newBroadcaster(),
		}
		globalChatJobs.jobs[key] = job
		globalChatJobs.mu.Unlock()

		go s.runBackgroundChat(job, msg)
	} else {
		globalChatJobs.mu.Unlock()
	}

	ch, history, done := job.Broadcaster.Subscribe()
	defer job.Broadcaster.Unsubscribe(ch)

	for _, h := range history {
		if err := stream.Send(h); err != nil {
			return err
		}
	}
	if done {
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case resp, ok := <-ch:
			if !ok || resp == nil {
				return nil
			}
			if err := stream.Send(resp); err != nil {
				return err
			}
			if resp.Done {
				return nil
			}
		}
	}
}

func (s *Server) runBackgroundChat(job *activeChatJob, msg *portv1.StreamChatRequest) {
	defer func() {
		globalChatJobs.mu.Lock()
		delete(globalChatJobs.jobs, chatJobKey{UserID: job.UserID, SessionID: job.SessionID})
		globalChatJobs.mu.Unlock()
	}()

	// Snapshot all AI config fields under a single read lock.
	s.configMu.RLock()
	cfgEndpoint := strings.TrimRight(s.config.AIEndpoint, "/")
	cfgModel := s.config.AIModel
	cfgContextSize := s.config.AIContextSize
	cfgSystemPrompt := s.config.AISystemPrompt
	s.configMu.RUnlock()

	ctx := job.Ctx
	requestedEndpoint := strings.TrimRight(strings.TrimSpace(msg.Endpoint), "/")
	endpoint := requestedEndpoint
	if endpoint == "" {
		endpoint = cfgEndpoint
	}
	parsedEndpoint, err := validateHTTPSOrLoopbackURL(endpoint)
	if len(endpoint) > 2048 || err != nil || parsedEndpoint.RawQuery != "" || parsedEndpoint.Fragment != "" {
		job.Broadcaster.Broadcast(&portv1.StreamChatResponse{ErrorMessage: "AI endpoint must be an HTTPS URL or a loopback HTTP URL without query parameters", Done: true})
		return
	}
	endpoint = strings.TrimRight(parsedEndpoint.String(), "/")
	model := strings.TrimSpace(msg.Model)
	if model == "" {
		model = cfgModel
	}
	if model == "" || len(model) > 256 {
		job.Broadcaster.Broadcast(&portv1.StreamChatResponse{ErrorMessage: "AI model is required and must not exceed 256 characters", Done: true})
		return
	}

	contextSize := msg.ContextSize
	if contextSize <= 0 {
		contextSize = int32(cfgContextSize)
	}
	if contextSize <= 0 {
		contextSize = 16384
	}
	if contextSize > maxAIContextSize {
		job.Broadcaster.Broadcast(&portv1.StreamChatResponse{ErrorMessage: "AI context size exceeds the supported limit", Done: true})
		return
	}

	if actualCtx := probeServerContext(ctx, endpoint); actualCtx > 0 && int32(actualCtx) < contextSize {
		slog.InfoContext(ctx, "Server context smaller than configured — using server limit", "server_n_ctx", actualCtx, "configured", contextSize)
		contextSize = int32(actualCtx)
	}
	job.ActualNCtx.Store(contextSize)

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

	totalPromptBudget := int(contextSize) - 500 - toolTokens
	if totalPromptBudget < 400 {
		totalPromptBudget = 400
	}

	basePrompt := cfgSystemPrompt
	baseTokens := len(basePrompt) / 3

	systemPrompt := basePrompt
	if msg.PortfolioContextJson != "" {
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

	for len(conversation) > 2 && estimateTokens(conversation[1:]) > maxHistoryTokens {
		conversation = append(conversation[:1], conversation[2:]...)
	}
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

	job.Broadcaster.Broadcast(&portv1.StreamChatResponse{ActualNCtx: contextSize})
	apiKey := s.aiAPIKey(msg.ApiKey, requestedEndpoint, endpoint)

	accumulatedContent, toolRecords, err := s.executeJobStreamChatPayload(ctx, job, endpoint, apiKey, payload, conversation, maxHistoryTokens, estimateTokens, 0)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			job.Broadcaster.Broadcast(&portv1.StreamChatResponse{ErrorMessage: err.Error(), Done: true})
		}
		return
	}

	if len(msg.Messages) > 0 {
		existingSession, _ := s.store.GetChatSession(context.Background(), job.SessionID, job.UserID)
		title := "New Conversation"
		if existingSession != nil && existingSession.Title != "" {
			title = existingSession.Title
		} else {
			for _, m := range msg.Messages {
				if m.Role == "user" && strings.TrimSpace(m.Content) != "" {
					title = strings.TrimSpace(m.Content)
					if len(title) > 42 {
						title = title[:42] + "..."
					}
					break
				}
			}
		}

		var messagesToSave []store.ChatMessageRecord
		for i, m := range msg.Messages {
			messagesToSave = append(messagesToSave, store.ChatMessageRecord{
				ID:        fmt.Sprintf("%s-msg-%d", job.SessionID, i),
				SessionID: job.SessionID,
				UserID:    job.UserID,
				Role:      m.Role,
				Content:   m.Content,
				Timestamp: time.Now().Format("15:04"),
			})
		}

		if strings.TrimSpace(accumulatedContent) != "" || len(toolRecords) > 0 {
			toolCallsJSON := ""
			if len(toolRecords) > 0 {
				b, _ := json.Marshal(toolRecords)
				toolCallsJSON = string(b)
			}
			messagesToSave = append(messagesToSave, store.ChatMessageRecord{
				ID:            fmt.Sprintf("%s-assistant-%d", job.SessionID, time.Now().UnixNano()),
				SessionID:     job.SessionID,
				UserID:        job.UserID,
				Role:          "assistant",
				Content:       accumulatedContent,
				Timestamp:     time.Now().Format("15:04"),
				ToolCallsJSON: toolCallsJSON,
			})
		}

		if err := s.store.SaveChatSession(context.Background(), &store.ChatSessionRecord{
			ID:       job.SessionID,
			UserID:   job.UserID,
			Title:    title,
			Messages: messagesToSave,
		}); err != nil {
			job.Broadcaster.Broadcast(&portv1.StreamChatResponse{ErrorMessage: "AI response completed but the conversation could not be saved", Done: true})
			return
		}
	}

	job.Broadcaster.Broadcast(&portv1.StreamChatResponse{Done: true})
}

func (s *Server) aiAPIKey(requestKey, requestedEndpoint, resolvedEndpoint string) string {
	if requestKey != "" {
		return requestKey
	}
	s.configMu.RLock()
	configuredEndpoint := strings.TrimRight(strings.TrimSpace(s.config.AIEndpoint), "/")
	cfgAPIKey := s.config.AIAPIKey
	s.configMu.RUnlock()
	if resolvedEndpoint == configuredEndpoint {
		return cfgAPIKey
	}
	return ""
}

func (s *Server) executeJobStreamChatPayload(
	ctx context.Context,
	job *activeChatJob,
	endpoint string,
	apiKey string,
	payload map[string]interface{},
	conversation []map[string]interface{},
	maxPromptTokens int,
	estimateTokens func([]map[string]interface{}) int,
	toolRound int,
) (string, []map[string]interface{}, error) {
	url := fmt.Sprintf("%s/chat/completions", endpoint)
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", nil, fmt.Errorf("encode AI request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", nil, fmt.Errorf("build AI request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	}

	client := &http.Client{Timeout: 0}
	res, err := client.Do(httpReq)
	if err != nil {
		return "", nil, fmt.Errorf("connect to AI provider at %s: %w", url, err)
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		errBody, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		return "", nil, fmt.Errorf("AI provider HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(errBody)))
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
	var accumulatedText strings.Builder
	var executedTools []map[string]interface{}

	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return accumulatedText.String(), executedTools, ctx.Err()
		default:
		}

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
			} `json:"choices"`
		}

		if err := json.Unmarshal([]byte(dataStr), &chunk); err == nil && len(chunk.Choices) > 0 {
			delta := chunk.Choices[0].Delta
			if delta.Content != "" {
				accumulatedText.WriteString(delta.Content)
				job.Broadcaster.Broadcast(&portv1.StreamChatResponse{
					DeltaText: delta.Content,
				})
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
		return accumulatedText.String(), executedTools, fmt.Errorf("read AI response: %w", err)
	}

	for i := 0; i < len(toolCallMap); i++ {
		if tc, ok := toolCallMap[i]; ok && tc.Function.Name != "" {
			pendingToolCalls = append(pendingToolCalls, *tc)
		}
	}

	if len(pendingToolCalls) > 0 && s.mcpHandler != nil && toolRound < 8 {
		var toolCallPayloads []map[string]interface{}
		var toolResults []map[string]interface{}

		for _, tc := range pendingToolCalls {
			select {
			case <-ctx.Done():
				return accumulatedText.String(), executedTools, ctx.Err()
			default:
			}

			var args map[string]interface{}
			resultJSON := ""
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil || args == nil {
				resultJSON = `{"error":"invalid tool arguments"}`
			} else if resultJSON, err = s.mcpHandler.ExecuteTool(ctx, tc.Function.Name, args); err != nil {
				resultJSON = fmt.Sprintf(`{"error": %q}`, err.Error())
			}

			executedTools = append(executedTools, map[string]interface{}{
				"name":   tc.Function.Name,
				"args":   args,
				"result": resultJSON,
			})

			job.Broadcaster.Broadcast(&portv1.StreamChatResponse{
				IsMcpToolCall:  true,
				ToolName:       tc.Function.Name,
				ToolArgsJson:   tc.Function.Arguments,
				ToolResultJson: resultJSON,
			})

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

		subContent, subTools, err := s.executeJobStreamChatPayload(ctx, job, endpoint, apiKey, nextPayload, conversation, maxPromptTokens, estimateTokens, toolRound+1)
		accumulatedText.WriteString(subContent)
		executedTools = append(executedTools, subTools...)
		if err != nil {
			return accumulatedText.String(), executedTools, err
		}
	}

	return accumulatedText.String(), executedTools, nil
}

func (s *Server) ListChatSessions(ctx context.Context, req *connect.Request[portv1.ListChatSessionsRequest]) (*connect.Response[portv1.ListChatSessionsResponse], error) {
	userID := auth.UserIDOrEmpty(ctx)
	sessions, err := s.store.ListChatSessions(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var res []*portv1.ChatSessionData
	for _, rec := range sessions {
		res = append(res, &portv1.ChatSessionData{
			Id:           rec.ID,
			Title:        rec.Title,
			CreatedAt:    rec.CreatedAt.Format(time.RFC3339),
			UpdatedAt:    rec.UpdatedAt.Format(time.RFC3339),
			MessageCount: int32(rec.MessageCount),
		})
	}
	return connect.NewResponse(&portv1.ListChatSessionsResponse{Sessions: res}), nil
}

func (s *Server) GetChatSession(ctx context.Context, req *connect.Request[portv1.GetChatSessionRequest]) (*connect.Response[portv1.GetChatSessionResponse], error) {
	if err := validateChatSessionID(strings.TrimSpace(req.Msg.Id)); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	userID := auth.UserIDOrEmpty(ctx)
	session, err := s.store.GetChatSession(ctx, req.Msg.Id, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if session == nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("chat session not found"))
	}

	var messages []*portv1.ChatMessageData
	for _, m := range session.Messages {
		messages = append(messages, &portv1.ChatMessageData{
			Id:            m.ID,
			Role:          m.Role,
			Content:       m.Content,
			Timestamp:     m.Timestamp,
			ToolCallsJson: m.ToolCallsJSON,
		})
	}

	return connect.NewResponse(&portv1.GetChatSessionResponse{
		Session: &portv1.ChatSessionData{
			Id:           session.ID,
			Title:        session.Title,
			CreatedAt:    session.CreatedAt.Format(time.RFC3339),
			UpdatedAt:    session.UpdatedAt.Format(time.RFC3339),
			Messages:     messages,
			MessageCount: int32(session.MessageCount),
		},
	}), nil
}

func (s *Server) SaveChatSession(ctx context.Context, req *connect.Request[portv1.SaveChatSessionRequest]) (*connect.Response[portv1.SaveChatSessionResponse], error) {
	userID := auth.UserIDOrEmpty(ctx)
	req.Msg.Id = strings.TrimSpace(req.Msg.Id)
	if err := validateChatSessionID(req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	title := strings.TrimSpace(req.Msg.Title)
	if title == "" {
		title = "New Conversation"
	}
	if len(title) > maxChatTitleSize {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("chat title exceeds 200 characters"))
	}
	if len(req.Msg.Messages) > maxChatMessages {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("chat history exceeds %d messages", maxChatMessages))
	}

	rec := store.ChatSessionRecord{
		ID:     req.Msg.Id,
		UserID: userID,
		Title:  title,
	}

	total := 0
	for _, m := range req.Msg.Messages {
		if m == nil || (m.Role != "user" && m.Role != "assistant" && m.Role != "tool" && m.Role != "error") {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("chat message has an unsupported role"))
		}
		if len(m.Content) > maxChatMessageSize {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("chat message exceeds 128 KiB"))
		}
		if len(m.Timestamp) > 64 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("chat timestamp exceeds 64 characters"))
		}
		if len(m.ToolCallsJson) > maxChatMessageSize || (m.ToolCallsJson != "" && !json.Valid([]byte(m.ToolCallsJson))) {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tool calls must be valid JSON no larger than 128 KiB"))
		}
		total += len(m.Content) + len(m.ToolCallsJson)
		rec.Messages = append(rec.Messages, store.ChatMessageRecord{
			ID:            m.Id,
			SessionID:     req.Msg.Id,
			UserID:        userID,
			Role:          m.Role,
			Content:       m.Content,
			Timestamp:     m.Timestamp,
			ToolCallsJSON: m.ToolCallsJson,
		})
	}
	if total > maxChatHistorySize {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("chat history exceeds 2 MiB"))
	}

	if err := s.store.SaveChatSession(ctx, &rec); err != nil {
		if errors.Is(err, store.ErrChatSessionOwnerMismatch) {
			return nil, connect.NewError(connect.CodePermissionDenied, errors.New("chat session belongs to another user"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	saved, err := s.store.GetChatSession(ctx, req.Msg.Id, userID)
	if err != nil || saved == nil {
		return connect.NewResponse(&portv1.SaveChatSessionResponse{Success: true}), nil
	}

	var messages []*portv1.ChatMessageData
	for _, m := range saved.Messages {
		messages = append(messages, &portv1.ChatMessageData{
			Id:            m.ID,
			Role:          m.Role,
			Content:       m.Content,
			Timestamp:     m.Timestamp,
			ToolCallsJson: m.ToolCallsJSON,
		})
	}

	return connect.NewResponse(&portv1.SaveChatSessionResponse{
		Success: true,
		Session: &portv1.ChatSessionData{
			Id:           saved.ID,
			Title:        saved.Title,
			CreatedAt:    saved.CreatedAt.Format(time.RFC3339),
			UpdatedAt:    saved.UpdatedAt.Format(time.RFC3339),
			Messages:     messages,
			MessageCount: int32(saved.MessageCount),
		},
	}), nil
}

func (s *Server) DeleteChatSession(ctx context.Context, req *connect.Request[portv1.DeleteChatSessionRequest]) (*connect.Response[portv1.DeleteChatSessionResponse], error) {
	if err := validateChatSessionID(strings.TrimSpace(req.Msg.Id)); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	userID := auth.UserIDOrEmpty(ctx)
	if err := s.store.DeleteChatSession(ctx, req.Msg.Id, userID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.DeleteChatSessionResponse{Success: true}), nil
}

func (s *Server) StopChatSession(ctx context.Context, req *connect.Request[portv1.StopChatSessionRequest]) (*connect.Response[portv1.StopChatSessionResponse], error) {
	sessionID := strings.TrimSpace(req.Msg.SessionId)
	if sessionID == "" {
		return connect.NewResponse(&portv1.StopChatSessionResponse{Success: false}), nil
	}
	if err := validateChatSessionID(sessionID); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	key := chatJobKey{UserID: auth.UserIDOrEmpty(ctx), SessionID: sessionID}

	globalChatJobs.mu.Lock()
	job, exists := globalChatJobs.jobs[key]
	if exists && job != nil {
		job.Cancel()
	}
	globalChatJobs.mu.Unlock()

	return connect.NewResponse(&portv1.StopChatSessionResponse{Success: true}), nil
}

func (s *Server) GetChatStatus(ctx context.Context, req *connect.Request[portv1.GetChatStatusRequest]) (*connect.Response[portv1.GetChatStatusResponse], error) {
	sessionID := strings.TrimSpace(req.Msg.SessionId)
	if sessionID == "" {
		return connect.NewResponse(&portv1.GetChatStatusResponse{IsGenerating: false}), nil
	}
	if err := validateChatSessionID(sessionID); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	key := chatJobKey{UserID: auth.UserIDOrEmpty(ctx), SessionID: sessionID}

	globalChatJobs.mu.Lock()
	job, exists := globalChatJobs.jobs[key]
	var nCtx int32
	if exists && job != nil {
		nCtx = job.ActualNCtx.Load()
	}
	globalChatJobs.mu.Unlock()

	return connect.NewResponse(&portv1.GetChatStatusResponse{
		IsGenerating: exists,
		SessionId:    sessionID,
		ActualNCtx:   nCtx,
	}), nil
}
