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
	"path/filepath"
	"strings"
	"sync"

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

func (s *Server) StreamChat(ctx context.Context, req *connect.Request[portv1.StreamChatRequest], stream *connect.ServerStream[portv1.StreamChatResponse]) error {
	msg := req.Msg
	endpoint := strings.TrimRight(strings.TrimSpace(msg.Endpoint), "/")
	if endpoint == "" {
		endpoint = "http://localhost:8080/v1"
	}
	model := strings.TrimSpace(msg.Model)
	if model == "" {
		model = "deepseek-r1-distill-qwen-7b"
	}

	systemPrompt := `You are an expert, local-first financial portfolio AI assistant for LOOT. You have full Model Context Protocol (MCP) access to backend Proto API tools (/mcp). Use tools like search_instruments, rank_instruments, get_summary, list_holdings, list_accounts, list_snapshots, and get_diagnostics to answer questions accurately. Never give legal or binding tax advice. Keep explanations simple, practical, and clear.`

	if msg.PortfolioContextJson != "" {
		systemPrompt += fmt.Sprintf("\n\nReal-time Live Portfolio State:\n```json\n%s\n```", msg.PortfolioContextJson)
	}

	var conversation []map[string]interface{}
	conversation = append(conversation, map[string]interface{}{
		"role":    "system",
		"content": systemPrompt,
	})

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

	contextSize := req.Msg.ContextSize
	if contextSize <= 0 {
		contextSize = int32(s.config.AIContextSize)
	}
	if contextSize <= 0 {
		contextSize = 16384
	}

	// Estimate token count (approx. 1 token = 4 characters)
	maxPromptTokens := int(contextSize) - 500
	if maxPromptTokens < 1000 {
		maxPromptTokens = 1000
	}

	estimateTokens := func(turns []map[string]interface{}) int {
		totalChars := 0
		for _, turn := range turns {
			if content, ok := turn["content"].(string); ok {
				totalChars += len(content)
			}
		}
		return totalChars / 4
	}

	// Prune older history turns if prompt trajectory exceeds context limit
	for len(conversation) > 2 && estimateTokens(conversation) > maxPromptTokens {
		conversation = append(conversation[:1], conversation[2:]...)
	}

	payload := map[string]interface{}{
		"model":       model,
		"messages":    conversation,
		"temperature": 0.3,
		"stream":      true,
		"max_tokens":  2048,
	}

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
	if msg.ApiKey != "" {
		httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", msg.ApiKey))
	}

	client := &http.Client{Timeout: 0}
	res, err := client.Do(httpReq)
	if err != nil {
		return connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to AI server at %s: %w", url, err))
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		errBody, _ := io.ReadAll(res.Body)
		return connect.NewError(connect.CodeInternal, fmt.Errorf("AI provider HTTP %d: %s", res.StatusCode, string(errBody)))
	}

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
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}

		if err := json.Unmarshal([]byte(dataStr), &chunk); err == nil {
			if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
				if err := stream.Send(&portv1.StreamChatResponse{
					DeltaText: chunk.Choices[0].Delta.Content,
				}); err != nil {
					return err
				}
			}
		}
	}

	_ = stream.Send(&portv1.StreamChatResponse{Done: true})
	return nil
}
