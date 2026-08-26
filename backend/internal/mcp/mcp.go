package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
)

// ToolDefinition represents an MCP tool definition.
type ToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"inputSchema"`
	RPCPath     string                 `json:"-"`
}

type CustomToolFunc func(ctx context.Context, args map[string]interface{}) (string, error)

// Handler handles MCP JSON-RPC 2.0 requests at /mcp.
type Handler struct {
	rpcHandler     http.Handler
	tools          map[string]ToolDefinition
	customHandlers map[string]CustomToolFunc
}

// NewHandler creates a new MCP HTTP Handler that proxies tool execution to the underlying Proto Connect RPC Handler.
func NewHandler(rpcHandler http.Handler) *Handler {
	h := &Handler{
		rpcHandler:     rpcHandler,
		tools:          make(map[string]ToolDefinition),
		customHandlers: make(map[string]CustomToolFunc),
	}
	for _, tool := range buildToolsFromProto() {
		h.tools[tool.Name] = tool
	}

	// Register web_search custom MCP tool
	h.RegisterCustomTool(WebSearchToolDefinition(), func(ctx context.Context, args map[string]interface{}) (string, error) {
		q, _ := args["query"].(string)
		return PerformWebSearch(ctx, q)
	})

	return h
}

// RegisterCustomTool registers a non-Proto custom tool definition and handler.
func (h *Handler) RegisterCustomTool(def ToolDefinition, fn CustomToolFunc) {
	h.tools[def.Name] = def
	h.customHandlers[def.Name] = fn
}

// OpenAITools returns all registered MCP tools in OpenAI function definitions format.
func (h *Handler) OpenAITools() []map[string]interface{} {
	var list []map[string]interface{}
	for _, tool := range h.tools {
		list = append(list, map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        tool.Name,
				"description": tool.Description,
				"parameters":  tool.InputSchema,
			},
		})
	}
	return list
}

// ExecuteTool dispatches an MCP tool call directly to the internal Connect RPC handler or custom handler and returns response JSON.
func (h *Handler) ExecuteTool(ctx context.Context, name string, args map[string]interface{}, authHeader ...string) (string, error) {
	tool, ok := h.tools[name]
	if !ok {
		return "", fmt.Errorf("unknown MCP tool %q", name)
	}
	if fn, isCustom := h.customHandlers[name]; isCustom {
		return fn(ctx, args)
	}
	return h.dispatchRPCCall(ctx, tool.RPCPath, args, authHeader...)
}

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type jsonRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id,omitempty"`
	Result  interface{} `json:"result,omitempty"`
	Error   interface{} `json:"error,omitempty"`
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method == http.MethodGet {
		// GET endpoint returns MCP server status and tool sitemap
		toolList := make([]ToolDefinition, 0, len(h.tools))
		for _, tool := range h.tools {
			toolList = append(toolList, tool)
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"name":        "squirrel-mcp",
			"version":     "1.0.0",
			"status":      "running",
			"endpoint":    "/mcp",
			"tools_count": len(toolList),
			"tools":       toolList,
		})
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		http.Error(w, "Read request body failed", http.StatusBadRequest)
		return
	}

	var req jsonRPCRequest
	if err := json.Unmarshal(body, &req); err != nil {
		h.writeError(w, nil, -32700, "Parse error", err.Error())
		return
	}

	switch req.Method {
	case "initialize":
		h.writeResult(w, req.ID, map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"capabilities": map[string]interface{}{
				"tools": map[string]interface{}{},
			},
			"serverInfo": map[string]interface{}{
				"name":    "squirrel-mcp",
				"version": "1.0.0",
			},
		})

	case "tools/list":
		toolList := make([]map[string]interface{}, 0, len(h.tools))
		for _, tool := range h.tools {
			toolList = append(toolList, map[string]interface{}{
				"name":        tool.Name,
				"description": tool.Description,
				"inputSchema": tool.InputSchema,
			})
		}
		h.writeResult(w, req.ID, map[string]interface{}{
			"tools": toolList,
		})

	case "tools/call":
		var callParams struct {
			Name      string                 `json:"name"`
			Arguments map[string]interface{} `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &callParams); err != nil {
			h.writeError(w, req.ID, -32602, "Invalid params", err.Error())
			return
		}

		tool, ok := h.tools[callParams.Name]
		if !ok {
			h.writeError(w, req.ID, -32601, "Method not found", fmt.Sprintf("Unknown tool %q", callParams.Name))
			return
		}

		// Dispatch tool call to underlying Connect RPC handler or custom tool handler
		resultJSON, err := h.ExecuteTool(r.Context(), tool.Name, callParams.Arguments, r.Header.Get("Authorization"))
		if err != nil {
			slog.Warn("MCP tool call error", "tool", tool.Name, "error", err)
			h.writeResult(w, req.ID, map[string]interface{}{
				"isError": true,
				"content": []map[string]interface{}{
					{
						"type": "text",
						"text": fmt.Sprintf("Error executing %s: %v", tool.Name, err),
					},
				},
			})
			return
		}

		h.writeResult(w, req.ID, map[string]interface{}{
			"content": []map[string]interface{}{
				{
					"type": "text",
					"text": resultJSON,
				},
			},
		})

	default:
		h.writeError(w, req.ID, -32601, "Method not found", fmt.Sprintf("Method %q not supported", req.Method))
	}
}

func (h *Handler) dispatchRPCCall(ctx context.Context, rpcPath string, args map[string]interface{}, authHeader ...string) (string, error) {
	if args == nil {
		args = make(map[string]interface{})
	}
	payloadBytes, err := json.Marshal(args)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rpcPath, bytes.NewReader(payloadBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if len(authHeader) > 0 && authHeader[0] != "" {
		req.Header.Set("Authorization", authHeader[0])
	}

	rec := httptest.NewRecorder()
	h.rpcHandler.ServeHTTP(rec, req)

	if rec.Code >= 400 {
		return "", fmt.Errorf("RPC HTTP %d: %s", rec.Code, rec.Body.String())
	}

	return rec.Body.String(), nil
}

func (h *Handler) writeResult(w http.ResponseWriter, id interface{}, result interface{}) {
	_ = json.NewEncoder(w).Encode(jsonRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	})
}

func (h *Handler) writeError(w http.ResponseWriter, id interface{}, code int, message string, data string) {
	_ = json.NewEncoder(w).Encode(jsonRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: map[string]interface{}{
			"code":    code,
			"message": message,
			"data":    data,
		},
	})
}
