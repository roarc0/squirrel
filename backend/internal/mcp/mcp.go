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

// Handler handles MCP JSON-RPC 2.0 requests at /mcp.
type Handler struct {
	rpcHandler http.Handler
	tools      map[string]ToolDefinition
}

// NewHandler creates a new MCP HTTP Handler that proxies tool execution to the underlying Proto Connect RPC Handler.
func NewHandler(rpcHandler http.Handler) http.Handler {
	h := &Handler{
		rpcHandler: rpcHandler,
		tools:      make(map[string]ToolDefinition),
	}
	h.registerProtoTools()
	return h
}

func (h *Handler) registerProtoTools() {
	toolsList := []ToolDefinition{
		{
			Name:        "get_summary",
			Description: "Retrieve current portfolio wealth summary across currencies, balance totals, and active health diagnostics.",
			RPCPath:     "/v1.SummaryService/GetSummary",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"target_cash_minor": map[string]interface{}{
						"type":        "integer",
						"description": "Optional target emergency cash goal in minor units (cents)",
					},
				},
			},
		},
		{
			Name:        "get_diagnostics",
			Description: "Retrieve active portfolio warnings, fee drag alerts, and allocation drift diagnostics.",
			RPCPath:     "/v1.SummaryService/GetDiagnostics",
			InputSchema: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
		{
			Name:        "list_accounts",
			Description: "List all bank, broker, and liquid cash accounts with current balances and PAC deposits.",
			RPCPath:     "/v1.AccountService/ListAccounts",
			InputSchema: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
		{
			Name:        "list_holdings",
			Description: "List actual investment holdings with asset classes, current values, invested capital, TER drag, and PAC shares.",
			RPCPath:     "/v1.HoldingService/ListHoldings",
			InputSchema: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
		{
			Name:        "list_instruments",
			Description: "List all saved instruments in the user catalog.",
			RPCPath:     "/v1.InstrumentService/ListInstruments",
			InputSchema: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
		{
			Name:        "search_instruments",
			Description: "Search the 4,000+ ETF catalog by ISIN, ticker, index name, asset class, or provider.",
			RPCPath:     "/v1.InstrumentService/SearchInstruments",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{
						"type":        "string",
						"description": "Search term e.g. 'MSCI World', 'S&P 500', 'IE00B4L5Y983', 'iShares'",
					},
				},
				"required": []string{"query"},
			},
		},
		{
			Name:        "rank_instruments",
			Description: "Rank ETF instruments according to cost/TER, tracking error, tracking difference, size, and age metrics.",
			RPCPath:     "/v1.InstrumentService/RankInstruments",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"index_query": map[string]interface{}{
						"type":        "string",
						"description": "Target benchmark index or exposure to filter rank candidates",
					},
					"max_ter_bps": map[string]interface{}{
						"type":        "integer",
						"description": "Maximum TER in basis points e.g. 20 for 0.20%",
					},
				},
			},
		},
		{
			Name:        "list_snapshots",
			Description: "List historical wealth snapshot records for net worth trend analysis.",
			RPCPath:     "/v1.SnapshotService/ListSnapshots",
			InputSchema: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
		{
			Name:        "list_tax_rates",
			Description: "List default and jurisdiction tax rates.",
			RPCPath:     "/v1.RateService/ListTaxRates",
			InputSchema: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
		{
			Name:        "list_ai_models",
			Description: "List available open-weights GGUF AI models in data/models/.",
			RPCPath:     "/v1.SystemService/ListAIModels",
			InputSchema: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
	}

	for _, tool := range toolsList {
		h.tools[tool.Name] = tool
	}
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
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

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
			"name":        "loot-mcp",
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

	body, err := io.ReadAll(r.Body)
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
				"name":    "loot-mcp",
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

		// Dispatch tool call to underlying Connect RPC handler
		resultJSON, err := h.dispatchRPCCall(r.Context(), tool.RPCPath, callParams.Arguments)
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

func (h *Handler) dispatchRPCCall(ctx context.Context, rpcPath string, args map[string]interface{}) (string, error) {
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
