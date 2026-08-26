package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"

	"github.com/roarc0/squirrel/backend/internal/config"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

var activeDownloads sync.Map // map[string]int32

func (s *Server) ListAIModels(ctx context.Context, req *connect.Request[portv1.ListAIModelsRequest]) (*connect.Response[portv1.ListAIModelsResponse], error) {
	modelsDir := filepath.Join("data", "models")
	if err := os.MkdirAll(modelsDir, 0o700); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("create models directory: %w", err))
	}
	_ = os.Chmod(modelsDir, 0o700)

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

	// Add any custom downloaded GGUF files not in the configured preset list.
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

	return connect.NewResponse(&portv1.ListAIModelsResponse{Models: result}), nil
}

func (s *Server) DownloadAIModel(ctx context.Context, req *connect.Request[portv1.DownloadAIModelRequest]) (*connect.Response[portv1.DownloadAIModelResponse], error) {
	if err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	modelQuery := strings.TrimSpace(req.Msg.ModelName)
	if modelQuery == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("model name or URL is required"))
	}
	if len(modelQuery) > 8192 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("model name or URL is too long"))
	}

	modelsDir := filepath.Join("data", "models")
	if err := os.MkdirAll(modelsDir, 0o700); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create data/models directory: %w", err))
	}
	_ = os.Chmod(modelsDir, 0o700)

	var downloadURL, filename, modelID string

	configuredModels := s.config.AIModels
	if len(configuredModels) == 0 {
		configuredModels = config.DefaultAIModels()
	}

	for _, preset := range configuredModels {
		if strings.EqualFold(preset.ID, modelQuery) || strings.EqualFold(preset.Filename, modelQuery) || strings.EqualFold(preset.Name, modelQuery) {
			downloadURL = preset.SourceURL
			filename = preset.Filename
			modelID = preset.ID
			break
		}
	}

	if downloadURL == "" {
		switch {
		case strings.HasPrefix(modelQuery, "http://") || strings.HasPrefix(modelQuery, "https://"):
			downloadURL = modelQuery
			parsed, err := url.Parse(modelQuery)
			if err != nil {
				return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid model URL: %w", err))
			}
			filename = filepath.Base(parsed.Path)
			if !strings.HasSuffix(strings.ToLower(filename), ".gguf") {
				filename += ".gguf"
			}
			modelID = strings.TrimSuffix(filename, ".gguf")
		case strings.Contains(modelQuery, "/"):
			parts := strings.Split(modelQuery, "/")
			repo := parts[len(parts)-1]
			filename = strings.ToLower(repo) + ".gguf"
			downloadURL = fmt.Sprintf("https://huggingface.co/%s/resolve/main/%s", modelQuery, filename)
			modelID = strings.ToLower(repo)
		default:
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("unknown model preset or invalid Hugging Face format %q. Use 'owner/repo' or direct GGUF URL", modelQuery))
		}
	}
	if override := strings.TrimSpace(req.Msg.UrlOverride); override != "" {
		if len(override) > 8192 {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("model URL is too long"))
		}
		downloadURL = override
	}
	parsedDownloadURL, err := validateModelDownloadURL(downloadURL)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	filename = filepath.Base(filename)
	if !validModelFilename(filename) {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid GGUF model filename %q", filename))
	}
	targetPath := filepath.Join(modelsDir, filename)
	tempPath := targetPath + ".tmp"

	if _, loaded := activeDownloads.LoadOrStore(modelID, int32(0)); loaded {
		return nil, connect.NewError(connect.CodeAlreadyExists, fmt.Errorf("model %s is already downloading", modelID))
	}
	defer activeDownloads.Delete(modelID)

	slog.InfoContext(ctx, "Starting AI model download", "model", modelID, "host", parsedDownloadURL.Hostname(), "target", targetPath)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, parsedDownloadURL.String(), nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("create download request failed: %w", err))
	}

	client := &http.Client{CheckRedirect: func(req *http.Request, _ []*http.Request) error {
		_, err := validateModelDownloadURL(req.URL.String())
		return err
	}}
	res, err := client.Do(httpReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to model host %s", parsedDownloadURL.Hostname()))
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("model download HTTP %d from %s", res.StatusCode, parsedDownloadURL.Hostname()))
	}

	out, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
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
	file, err := os.Open(tempPath)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("inspect downloaded model: %w", err))
	}
	var magic [4]byte
	_, readErr := io.ReadFull(file, magic[:])
	_ = file.Close()
	if readErr != nil || string(magic[:]) != "GGUF" {
		_ = os.Remove(tempPath)
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("download is not a GGUF model"))
	}

	if err := os.Rename(tempPath, targetPath); err != nil {
		_ = os.Remove(tempPath)
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

func (s *Server) ListOllamaModels(ctx context.Context, req *connect.Request[portv1.ListOllamaModelsRequest]) (*connect.Response[portv1.ListOllamaModelsResponse], error) {
	if err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	endpoint := strings.TrimSuffix(strings.TrimSuffix(req.Msg.Endpoint, "/v1"), "/")
	if endpoint == "" {
		endpoint = "http://localhost:11434"
	}
	parsedEndpoint, err := validateHTTPSOrLoopbackURL(endpoint)
	if err != nil || parsedEndpoint.RawQuery != "" || parsedEndpoint.Fragment != "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid Ollama endpoint"))
	}
	endpoint = strings.TrimRight(parsedEndpoint.String(), "/")

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
		body, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("ollama /api/tags HTTP %d: %s", res.StatusCode, string(body)))
	}

	var resp struct {
		Models []struct {
			Name       string `json:"name"`
			Size       int64  `json:"size"`
			ModifiedAt string `json:"modified_at"`
		} `json:"models"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&resp); err != nil {
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
	if err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	endpoint := strings.TrimSuffix(strings.TrimSuffix(req.Msg.Endpoint, "/v1"), "/")
	if endpoint == "" {
		endpoint = "http://localhost:11434"
	}
	parsedEndpoint, err := validateHTTPSOrLoopbackURL(endpoint)
	if err != nil || parsedEndpoint.RawQuery != "" || parsedEndpoint.Fragment != "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid Ollama endpoint"))
	}
	endpoint = strings.TrimRight(parsedEndpoint.String(), "/")
	model := req.Msg.Model
	if model == "" || len(model) > 256 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid Ollama model name"))
	}
	contextSize := req.Msg.ContextSize
	if contextSize <= 0 {
		contextSize = 16384
	}
	if contextSize > maxAIContextSize {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("AI context size is too large"))
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
		errBody, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("ollama load HTTP %d: %s", res.StatusCode, string(errBody)))
	}

	slog.InfoContext(ctx, "Ollama model loaded", "model", model, "num_ctx", contextSize)
	return connect.NewResponse(&portv1.LoadOllamaModelResponse{
		Success: true,
		Message: fmt.Sprintf("Model %s loaded with %d token context", model, contextSize),
	}), nil
}

func (s *Server) RestartLocalServer(ctx context.Context, req *connect.Request[portv1.RestartLocalServerRequest]) (*connect.Response[portv1.RestartLocalServerResponse], error) {
	if err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	requestedFilename := strings.TrimSpace(req.Msg.ModelFilename)
	filename := filepath.Base(requestedFilename)
	if filename != requestedFilename || !validModelFilename(filename) {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid GGUF model filename"))
	}
	contextSize := req.Msg.ContextSize
	if contextSize <= 0 {
		contextSize = 16384
	}
	if contextSize > maxAIContextSize {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("AI context size is too large"))
	}
	port := int(req.Msg.Port)
	if port <= 0 {
		port = 8080
	}
	if port > 65535 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid server port"))
	}

	modelPath := filepath.Join("data", "models", filename)
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("model file not found: %s", modelPath))
	}

	pidFile := filepath.Join("data", "models", "llama-server.pid")

	// Kill existing llama-server via PID file.
	if pidBytes, err := os.ReadFile(pidFile); err == nil {
		if pid, err := strconv.Atoi(strings.TrimSpace(string(pidBytes))); err == nil {
			command, _ := exec.CommandContext(ctx, "ps", "-p", strconv.Itoa(pid), "-o", "comm=").Output()
			if filepath.Base(strings.TrimSpace(string(command))) == "llama-server" {
				if proc, err := os.FindProcess(pid); err == nil {
					_ = proc.Kill()
				}
			}
		}
		_ = os.Remove(pidFile)
	}
	time.Sleep(500 * time.Millisecond)

	alias := strings.TrimSuffix(filename, ".gguf")
	logPath := filepath.Join("data", "models", "llama-server.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
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
		"--jinja",      // Jinja2 chat template — required for tool/function calling
		"--flash-attn", // flash attention — faster inference and larger context on Apple Silicon
	)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("start llama-server: %w", err))
	}
	_ = logFile.Close()

	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0o600); err != nil {
		slog.WarnContext(ctx, "Failed to write llama-server PID file", "err", err)
	}

	// Wait up to 10s for server to become ready.
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", port)
	ready := false
	for i := 0; i < 20; i++ {
		time.Sleep(500 * time.Millisecond)
		if n := probeServerContext(ctx, endpoint+"/v1"); n > 0 {
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

func validateModelDownloadURL(raw string) (*url.URL, error) {
	parsed, err := validateHTTPSOrLoopbackURL(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid model download URL: %w", err)
	}
	return parsed, nil
}

func validModelFilename(filename string) bool {
	if len(filename) <= len(".gguf") || len(filename) > 255 || !strings.HasSuffix(strings.ToLower(filename), ".gguf") {
		return false
	}
	for _, char := range filename {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '.' && char != '-' && char != '_' {
			return false
		}
	}
	return true
}
