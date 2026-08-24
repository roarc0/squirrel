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
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"

	"loot/backend/internal/config"
	portv1 "loot/proto/gen/go/v1"
)

var activeDownloads sync.Map // map[string]int32

type progressWriter struct {
	total      int64
	downloaded int64
	onProgress func(percent int32)
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n := len(p)
	pw.downloaded += int64(n)
	var pct int32
	if pw.total > 0 {
		pct = int32((pw.downloaded * 100) / pw.total)
		if pct > 100 {
			pct = 100
		}
	}
	if pw.onProgress != nil {
		pw.onProgress(pct)
	}
	return n, nil
}

func (s *Server) ExportBackup(ctx context.Context, req *connect.Request[portv1.ExportBackupRequest]) (*connect.Response[portv1.ExportBackupResponse], error) {
	data, filename, err := s.store.ExportBackup(ctx, s.store.DBPath())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.ExportBackupResponse{
		BackupTarGz: data,
		Filename:    filename,
	}), nil
}

func (s *Server) RestoreBackup(ctx context.Context, req *connect.Request[portv1.RestoreBackupRequest]) (*connect.Response[portv1.RestoreBackupResponse], error) {
	if len(req.Msg.BackupTarGz) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("backup data is empty"))
	}
	if err := s.store.RestoreBackup(ctx, s.store.DBPath(), req.Msg.BackupTarGz); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.RestoreBackupResponse{
		Success: true,
		Message: "Database restored successfully",
	}), nil
}

func (s *Server) ListAIModels(ctx context.Context, req *connect.Request[portv1.ListAIModelsRequest]) (*connect.Response[portv1.ListAIModelsResponse], error) {
	modelsDir := filepath.Join("data", "models")
	_ = os.MkdirAll(modelsDir, 0755)

	existingFiles := make(map[string]os.FileInfo)
	entries, err := os.ReadDir(modelsDir)
	if err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".gguf") {
				if info, err := entry.Info(); err == nil {
					existingFiles[entry.Name()] = info
				}
			}
		}
	}

	configuredModels := s.config.AIModels
	if len(configuredModels) == 0 {
		configuredModels = config.DefaultAIModels()
	}

	result := make([]*portv1.AIModelInfo, 0, len(configuredModels)+len(existingFiles))
	handledFilenames := make(map[string]bool)

	for _, preset := range configuredModels {
		info, downloaded := existingFiles[preset.Filename]
		var sizeBytes int64
		if downloaded {
			sizeBytes = info.Size()
		}
		handledFilenames[preset.Filename] = true

		var downloadPercent int32
		var isDownloading bool
		if val, ok := activeDownloads.Load(preset.ID); ok {
			isDownloading = true
			downloadPercent = val.(int32)
		}

		result = append(result, &portv1.AIModelInfo{
			Id:              preset.ID,
			Name:            preset.Name,
			Filename:        preset.Filename,
			SizeBytes:       sizeBytes,
			IsDownloaded:    downloaded,
			SourceUrl:       preset.SourceURL,
			Description:     preset.Description,
			DownloadPercent: downloadPercent,
			IsDownloading:   isDownloading,
		})
	}

	// Add any custom downloaded GGUF files in data/models/
	for filename, info := range existingFiles {
		if handledFilenames[filename] {
			continue
		}
		modelID := strings.TrimSuffix(filename, ".gguf")
		var downloadPercent int32
		var isDownloading bool
		if val, ok := activeDownloads.Load(modelID); ok {
			isDownloading = true
			downloadPercent = val.(int32)
		}

		result = append(result, &portv1.AIModelInfo{
			Id:              modelID,
			Name:            fmt.Sprintf("Custom Model (%s)", filename),
			Filename:        filename,
			SizeBytes:       info.Size(),
			IsDownloaded:    true,
			SourceUrl:       "",
			Description:     "Custom downloaded GGUF model in data/models/",
			DownloadPercent: downloadPercent,
			IsDownloading:   isDownloading,
		})
	}

	return connect.NewResponse(&portv1.ListAIModelsResponse{
		Models: result,
	}), nil
}

func (s *Server) DownloadAIModel(ctx context.Context, req *connect.Request[portv1.DownloadAIModelRequest]) (*connect.Response[portv1.DownloadAIModelResponse], error) {
	modelQuery := strings.TrimSpace(req.Msg.ModelName)
	if modelQuery == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("model name or URL is required"))
	}

	modelsDir := filepath.Join("data", "models")
	if err := os.MkdirAll(modelsDir, 0755); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create data/models directory: %w", err))
	}

	var downloadURL string
	var filename string
	var modelID string

	configuredModels := s.config.AIModels
	if len(configuredModels) == 0 {
		configuredModels = config.DefaultAIModels()
	}

	// Check if matching preset
	for _, preset := range configuredModels {
		if strings.EqualFold(preset.ID, modelQuery) || strings.EqualFold(preset.Filename, modelQuery) || strings.EqualFold(preset.Name, modelQuery) {
			downloadURL = preset.SourceURL
			filename = preset.Filename
			modelID = preset.ID
			break
		}
	}

	// If custom URL or Hugging Face repo
	if downloadURL == "" {
		if strings.HasPrefix(modelQuery, "http://") || strings.HasPrefix(modelQuery, "https://") {
			downloadURL = modelQuery
			parts := strings.Split(modelQuery, "/")
			filename = parts[len(parts)-1]
			if !strings.HasSuffix(filename, ".gguf") {
				filename = filename + ".gguf"
			}
			modelID = strings.TrimSuffix(filename, ".gguf")
		} else if strings.Contains(modelQuery, "/") {
			parts := strings.Split(modelQuery, "/")
			repo := parts[len(parts)-1]
			filename = strings.ToLower(repo) + ".gguf"
			downloadURL = fmt.Sprintf("https://huggingface.co/%s/resolve/main/%s", modelQuery, filename)
			modelID = strings.ToLower(repo)
		} else {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("unknown model preset or invalid Hugging Face format %q. Use 'owner/repo' or direct GGUF URL", modelQuery))
		}
	}

	targetPath := filepath.Join(modelsDir, filename)
	tempPath := targetPath + ".tmp"

	activeDownloads.Store(modelID, int32(0))
	defer activeDownloads.Delete(modelID)

	slog.InfoContext(ctx, "Starting AI model download", "model", modelID, "url", downloadURL, "target", targetPath)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("create download request failed: %w", err))
	}

	res, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to model download URL: %w", err))
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("download HTTP %d from %s", res.StatusCode, downloadURL))
	}

	out, err := os.Create(tempPath)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create temporary file: %w", err))
	}

	pw := &progressWriter{
		total: res.ContentLength,
		onProgress: func(pct int32) {
			activeDownloads.Store(modelID, pct)
		},
	}

	_, err = io.Copy(out, io.TeeReader(res.Body, pw))
	_ = out.Close()

	if err != nil {
		_ = os.Remove(tempPath)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("download stream failed: %w", err))
	}

	if err := os.Rename(tempPath, targetPath); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to save final model file: %w", err))
	}

	activeDownloads.Store(modelID, int32(100))
	slog.InfoContext(ctx, "AI model downloaded successfully", "model", modelID, "file", targetPath)

	return connect.NewResponse(&portv1.DownloadAIModelResponse{
		Success:  true,
		Message:  fmt.Sprintf("Successfully downloaded %s into %s", filename, targetPath),
		ModelId:  modelID,
		FilePath: targetPath,
	}), nil
}

// probeServerContext tries to read the actual n_ctx from a running llama-server /props endpoint.
// Returns 0 if not available (non-llama-server or unreachable).
func probeServerContext(endpoint string) int {
	base := strings.TrimSuffix(strings.TrimSuffix(endpoint, "/v1"), "/")
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, base+"/props", nil)
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
	if json.NewDecoder(res.Body).Decode(&props) == nil && props.NCtx > 0 {
		return props.NCtx
	}
	return 0
}

func (s *Server) StreamChat(ctx context.Context, req *connect.Request[portv1.StreamChatRequest], stream *connect.ServerStream[portv1.StreamChatResponse]) error {
	msg := req.Msg
	endpoint := strings.TrimRight(strings.TrimSpace(msg.Endpoint), "/")
	if endpoint == "" {
		endpoint = "http://localhost:8080/v1"
	}
	model := strings.TrimSpace(msg.Model)
	if model == "" {
		model = s.config.AIModel
	}

	contextSize := req.Msg.ContextSize
	if contextSize <= 0 {
		contextSize = int32(s.config.AIContextSize)
	}
	if contextSize <= 0 {
		contextSize = 16384
	}

	// Probe the actual server context window — overrides user setting when server is smaller.
	// This makes the context budget accurate regardless of what the user configured.
	if actualCtx := probeServerContext(endpoint); actualCtx > 0 && int32(actualCtx) < contextSize {
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
	return s.executeStreamChatPayload(ctx, endpoint, msg.ApiKey, payload, conversation, stream, maxHistoryTokens, estimateTokens)
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
		errBody, _ := io.ReadAll(res.Body)

		// On context overflow errors: extract the server's actual n_ctx, truncate system message, retry once.
		var errResp struct {
			Error struct {
				Type  string `json:"type"`
				NCtx  int    `json:"n_ctx"`
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
			bodyBytes2, _ := json.Marshal(payload)
			httpReq2, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes2))
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
				errBody2, _ := io.ReadAll(res2.Body)
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
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		dataStr := strings.TrimPrefix(line, "data: ")
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

	for i := 0; i < len(toolCallMap); i++ {
		if tc, ok := toolCallMap[i]; ok && tc.Function.Name != "" {
			pendingToolCalls = append(pendingToolCalls, *tc)
		}
	}

	if len(pendingToolCalls) > 0 && s.mcpHandler != nil {
		var toolCallPayloads []map[string]interface{}
		var toolResults []map[string]interface{}

		for _, tc := range pendingToolCalls {
			var args map[string]interface{}
			_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
			if args == nil {
				args = make(map[string]interface{})
			}

			resultJSON, err := s.mcpHandler.ExecuteTool(ctx, tc.Function.Name, args)
			if err != nil {
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

		return s.executeStreamChatPayload(ctx, endpoint, apiKey, nextPayload, conversation, stream, maxPromptTokens, estimateTokens)
	}

	_ = stream.Send(&portv1.StreamChatResponse{Done: true})
	return nil
}

func (s *Server) ListOllamaModels(ctx context.Context, req *connect.Request[portv1.ListOllamaModelsRequest]) (*connect.Response[portv1.ListOllamaModelsResponse], error) {
	endpoint := strings.TrimSuffix(strings.TrimSuffix(req.Msg.Endpoint, "/v1"), "/")
	if endpoint == "" {
		endpoint = "http://localhost:11434"
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/api/tags", nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("build request: %w", err))
	}

	res, err := (&http.Client{}).Do(httpReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("ollama unreachable at %s: %w", endpoint, err))
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		body, _ := io.ReadAll(res.Body)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("ollama /api/tags HTTP %d: %s", res.StatusCode, string(body)))
	}

	var resp struct {
		Models []struct {
			Name       string `json:"name"`
			Size       int64  `json:"size"`
			ModifiedAt string `json:"modified_at"`
		} `json:"models"`
	}
	if err := json.NewDecoder(res.Body).Decode(&resp); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("decode ollama response: %w", err))
	}

	models := make([]*portv1.OllamaModelInfo, 0, len(resp.Models))
	for _, m := range resp.Models {
		models = append(models, &portv1.OllamaModelInfo{
			Name:       m.Name,
			SizeBytes:  m.Size,
			ModifiedAt: m.ModifiedAt,
		})
	}

	return connect.NewResponse(&portv1.ListOllamaModelsResponse{Models: models}), nil
}

func (s *Server) LoadOllamaModel(ctx context.Context, req *connect.Request[portv1.LoadOllamaModelRequest]) (*connect.Response[portv1.LoadOllamaModelResponse], error) {
	endpoint := strings.TrimSuffix(strings.TrimSuffix(req.Msg.Endpoint, "/v1"), "/")
	if endpoint == "" {
		endpoint = "http://localhost:11434"
	}
	model := req.Msg.Model
	contextSize := req.Msg.ContextSize
	if contextSize <= 0 {
		contextSize = 16384
	}

	body, _ := json.Marshal(map[string]interface{}{
		"model":      model,
		"keep_alive": "30m",
		"stream":     false,
		"options": map[string]interface{}{
			"num_ctx": contextSize,
		},
	})

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("build request: %w", err))
	}
	httpReq.Header.Set("Content-Type", "application/json")

	res, err := (&http.Client{}).Do(httpReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("ollama unreachable at %s: %w", endpoint, err))
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		errBody, _ := io.ReadAll(res.Body)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("ollama load HTTP %d: %s", res.StatusCode, string(errBody)))
	}

	slog.InfoContext(ctx, "Ollama model loaded", "model", model, "num_ctx", contextSize)
	return connect.NewResponse(&portv1.LoadOllamaModelResponse{
		Success: true,
		Message: fmt.Sprintf("Model %s loaded with %d token context", model, contextSize),
	}), nil
}

func (s *Server) RestartLocalServer(ctx context.Context, req *connect.Request[portv1.RestartLocalServerRequest]) (*connect.Response[portv1.RestartLocalServerResponse], error) {
	filename := strings.TrimSpace(req.Msg.ModelFilename)
	if filename == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("model_filename is required"))
	}
	contextSize := req.Msg.ContextSize
	if contextSize <= 0 {
		contextSize = 16384
	}
	port := int(req.Msg.Port)
	if port <= 0 {
		port = 8080
	}

	modelPath := filepath.Join("data", "models", filename)
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("model file not found: %s", modelPath))
	}

	pidFile := filepath.Join("data", "models", "llama-server.pid")

	// Kill existing llama-server via PID file.
	if pidBytes, err := os.ReadFile(pidFile); err == nil {
		if pid, err := strconv.Atoi(strings.TrimSpace(string(pidBytes))); err == nil {
			if proc, err := os.FindProcess(pid); err == nil {
				_ = proc.Kill()
			}
		}
		_ = os.Remove(pidFile)
	}
	// Also kill any stray llama-server processes.
	_ = exec.Command("pkill", "-f", "llama-server").Run()
	time.Sleep(500 * time.Millisecond)

	alias := strings.TrimSuffix(filename, ".gguf")
	logPath := filepath.Join("data", "models", "llama-server.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("open log file: %w", err))
	}

	cmd := exec.Command("llama-server",
		"-m", modelPath,
		"--port", strconv.Itoa(port),
		"--host", "127.0.0.1",
		"-ngl", "99",
		"-c", strconv.Itoa(int(contextSize)),
		"--alias", alias,
		"--jinja",        // Jinja2 chat template — required for tool/function calling
		"--flash-attn",   // flash attention — faster inference and larger context on Apple Silicon
	)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("start llama-server: %w", err))
	}
	_ = logFile.Close()

	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644); err != nil {
		slog.WarnContext(ctx, "Failed to write llama-server PID file", "err", err)
	}

	// Wait up to 10s for server to become ready.
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", port)
	ready := false
	for i := 0; i < 20; i++ {
		time.Sleep(500 * time.Millisecond)
		if n := probeServerContext(endpoint + "/v1"); n > 0 {
			ready = true
			slog.InfoContext(ctx, "llama-server ready", "pid", cmd.Process.Pid, "n_ctx", n, "model", filename)
			break
		}
	}

	msg := fmt.Sprintf("llama-server started (PID %d) with %s, context %d", cmd.Process.Pid, filename, contextSize)
	if !ready {
		msg += " — server still loading, give it a few seconds"
	}
	return connect.NewResponse(&portv1.RestartLocalServerResponse{
		Success:    true,
		Message:    msg,
		Port:       int32(port),
		ActualNCtx: contextSize,
	}), nil
}
