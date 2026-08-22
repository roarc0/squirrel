package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"connectrpc.com/connect"

	portv1 "loot/proto/gen/go/v1"
)

type PresetModel struct {
	ID          string
	Name        string
	Filename    string
	SourceURL   string
	Description string
}

var presetAIModels = []PresetModel{
	{
		ID:          "qwen2.5-3b-instruct",
		Name:        "Qwen 2.5 3B Instruct (Default)",
		Filename:    "qwen2.5-3b-instruct-q4_k_m.gguf",
		SourceURL:   "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
		Description: "3B parameters, high accuracy for financial analysis & portfolio rebalancing.",
	},
	{
		ID:          "qwen2.5-1.5b-instruct",
		Name:        "Qwen 2.5 1.5B Instruct",
		Filename:    "qwen2.5-1.5b-instruct-q4_k_m.gguf",
		SourceURL:   "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
		Description: "Lightweight 1.5B parameters, ultra-fast response.",
	},
	{
		ID:          "llama-3.2-3b-instruct",
		Name:        "Llama 3.2 3B Instruct",
		Filename:    "llama-3.2-3b-instruct-q4_k_m.gguf",
		SourceURL:   "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
		Description: "Meta Llama 3.2 3B reasoning model.",
	},
	{
		ID:          "deepseek-r1-distill-qwen-1.5b",
		Name:        "DeepSeek R1 Distill Qwen 1.5B",
		Filename:    "deepseek-r1-distill-qwen-1.5b-q4_k_m.gguf",
		SourceURL:   "https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
		Description: "Reasoning-focused distilled 1.5B model.",
	},
	{
		ID:          "gemma-2-2b-it",
		Name:        "Gemma 2 2B IT",
		Filename:    "gemma-2-2b-it-q4_k_m.gguf",
		SourceURL:   "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf",
		Description: "Google Gemma 2 2B instruct model.",
	},
	{
		ID:          "phi-3.5-mini-instruct",
		Name:        "Phi 3.5 Mini Instruct",
		Filename:    "phi-3.5-mini-instruct-q4_k_m.gguf",
		SourceURL:   "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
		Description: "Microsoft Phi 3.5 Mini 3.8B instruct model.",
	},
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

	result := make([]*portv1.AIModelInfo, 0, len(presetAIModels)+len(existingFiles))
	handledFilenames := make(map[string]bool)

	for _, preset := range presetAIModels {
		info, downloaded := existingFiles[preset.Filename]
		var sizeBytes int64
		if downloaded {
			sizeBytes = info.Size()
		}
		handledFilenames[preset.Filename] = true

		result = append(result, &portv1.AIModelInfo{
			Id:           preset.ID,
			Name:         preset.Name,
			Filename:     preset.Filename,
			SizeBytes:    sizeBytes,
			IsDownloaded: downloaded,
			SourceUrl:    preset.SourceURL,
			Description:  preset.Description,
		})
	}

	// Add any custom downloaded GGUF files in data/models/
	for filename, info := range existingFiles {
		if handledFilenames[filename] {
			continue
		}
		modelID := strings.TrimSuffix(filename, ".gguf")
		result = append(result, &portv1.AIModelInfo{
			Id:           modelID,
			Name:         fmt.Sprintf("Custom Model (%s)", filename),
			Filename:     filename,
			SizeBytes:    info.Size(),
			IsDownloaded: true,
			SourceUrl:    "",
			Description:  "Custom downloaded GGUF model in data/models/",
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

	// Check if matching preset
	for _, preset := range presetAIModels {
		if strings.EqualFold(preset.ID, modelQuery) || strings.EqualFold(preset.Filename, modelQuery) || strings.EqualFold(preset.Name, modelQuery) {
			downloadURL = preset.SourceURL
			filename = preset.Filename
			modelID = preset.ID
			break
		}
	}

	// If custom URL
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
			// e.g. "Qwen/Qwen2.5-1.5B-Instruct-GGUF"
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

	_, err = io.Copy(out, res.Body)
	_ = out.Close()

	if err != nil {
		_ = os.Remove(tempPath)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("download stream failed: %w", err))
	}

	if err := os.Rename(tempPath, targetPath); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to save final model file: %w", err))
	}

	slog.InfoContext(ctx, "AI model downloaded successfully", "model", modelID, "file", targetPath)

	return connect.NewResponse(&portv1.DownloadAIModelResponse{
		Success:  true,
		Message:  fmt.Sprintf("Successfully downloaded %s into %s", filename, targetPath),
		ModelId:  modelID,
		FilePath: targetPath,
	}), nil
}
