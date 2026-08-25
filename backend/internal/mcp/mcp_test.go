package mcp_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"squirrel/backend/internal/mcp"
)

type dummyHandler struct{}

func (d *dummyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/v1.SummaryService/GetSummary" {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"summary":{"baseCurrency":"EUR"}}`))
		return
	}
	http.NotFound(w, r)
}

func TestMCPHandlerGET(t *testing.T) {
	handler := mcp.NewHandler(&dummyHandler{})
	req := httptest.NewRequest(http.MethodGet, "/mcp", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if resp["name"] != "squirrel-mcp" {
		t.Errorf("expected server name squirrel-mcp, got %v", resp["name"])
	}
}

func TestMCPHandlerInitialize(t *testing.T) {
	handler := mcp.NewHandler(&dummyHandler{})
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`)
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	result, ok := resp["result"].(map[string]interface{})
	if !ok || result["protocolVersion"] != "2024-11-05" {
		t.Errorf("invalid initialize result: %v", resp)
	}
}

func TestMCPHandlerToolsList(t *testing.T) {
	handler := mcp.NewHandler(&dummyHandler{})
	body := []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`)
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	result := resp["result"].(map[string]interface{})
	tools := result["tools"].([]interface{})
	if len(tools) == 0 {
		t.Errorf("expected tools list to contain tools, got 0")
	}
}

func TestMCPHandlerToolsCall(t *testing.T) {
	handler := mcp.NewHandler(&dummyHandler{})
	body := []byte(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_summary","arguments":{}}}`)
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	result := resp["result"].(map[string]interface{})
	content := result["content"].([]interface{})
	if len(content) == 0 {
		t.Fatalf("expected content in result")
	}
}
