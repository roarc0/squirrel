version := env_var_or_default("VERSION", "dev")

generate:
	cd proto && just generate

ui: generate
	cd ui && npm run build

run *args: ui
	CGO_ENABLED=0 go run github.com/air-verse/air@latest -- {{args}}

build: ui
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version={{version}}" -o bin/loot ./backend/cmd/loot

test: ui
	CGO_ENABLED=0 go test ./backend/...
	cd ui && npm run check
	cd ui && npm test

ai-setup:
	@mkdir -p data/models
	@if ! command -v llama-server >/dev/null 2>&1; then \
		echo "Installing llama.cpp via Homebrew..."; \
		brew install llama.cpp; \
	fi
	@if [ ! -f data/models/qwen2.5-3b-instruct-q4_k_m.gguf ]; then \
		echo "Downloading Qwen2.5-3B-Instruct GGUF into data/models/..."; \
		curl -L -C - -o data/models/qwen2.5-3b-instruct-q4_k_m.gguf "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf"; \
	else \
		echo "Model data/models/qwen2.5-3b-instruct-q4_k_m.gguf is ready."; \
	fi

ai-start: ai-setup
	#!/usr/bin/env bash
	if [ -f data/models/llama-server.pid ] && kill -0 $(cat data/models/llama-server.pid) 2>/dev/null; then
		echo "Local AI OpenAI Server is already running on http://127.0.0.1:8080/v1 (PID $(cat data/models/llama-server.pid))"
	else
		echo "Starting Local AI OpenAI Server on http://127.0.0.1:8080/v1 (Metal GPU enabled)..."
		nohup llama-server -m data/models/qwen2.5-3b-instruct-q4_k_m.gguf --port 8080 --host 127.0.0.1 -ngl 99 -c 16384 --alias qwen2.5-3b-instruct > data/models/llama-server.log 2>&1 &
		echo $! > data/models/llama-server.pid
		echo "Local AI Server started (PID $(cat data/models/llama-server.pid)). Logs: data/models/llama-server.log"
	fi

ai-stop:
	#!/usr/bin/env bash
	if [ -f data/models/llama-server.pid ]; then
		pid=$(cat data/models/llama-server.pid)
		echo "Stopping Local AI Server (PID $pid)..."
		kill $pid 2>/dev/null || true
		rm -f data/models/llama-server.pid
	else
		echo "No running Local AI Server PID file found."
	fi

ai-status:
	#!/usr/bin/env bash
	if [ -f data/models/llama-server.pid ] && kill -0 $(cat data/models/llama-server.pid) 2>/dev/null; then
		echo "Local AI Server status: RUNNING (PID $(cat data/models/llama-server.pid)) on http://127.0.0.1:8080/v1"
		curl -s http://127.0.0.1:8080/v1/models || true
		echo ""
	elif [ -f data/models/ollama.pid ] && kill -0 $(cat data/models/ollama.pid) 2>/dev/null; then
		echo "Ollama status: RUNNING (PID $(cat data/models/ollama.pid)) on http://127.0.0.1:11434/v1"
		curl -s http://127.0.0.1:11434/v1/models || true
		echo ""
	else
		echo "Local AI Server status: STOPPED"
	fi

run-ollama:
	#!/usr/bin/env bash
	mkdir -p data/models
	if ! command -v ollama >/dev/null 2>&1; then
		echo "Installing Ollama via Homebrew..."
		brew install ollama
	fi
	if [ -f data/models/ollama.pid ] && kill -0 $(cat data/models/ollama.pid) 2>/dev/null; then
		echo "Ollama server is already running on http://127.0.0.1:11434/v1 (PID $(cat data/models/ollama.pid))"
	else
		echo "Starting Ollama server in background..."
		nohup ollama serve > data/models/ollama.log 2>&1 &
		echo $! > data/models/ollama.pid
		sleep 2
	fi
	echo "Ensuring default model qwen2.5:3b is pulled into Ollama..."
	ollama pull qwen2.5:3b
	echo "Ollama is ready on http://127.0.0.1:11434/v1 with model qwen2.5:3b"

stop-ollama:
	#!/usr/bin/env bash
	if [ -f data/models/ollama.pid ]; then
		pid=$(cat data/models/ollama.pid)
		echo "Stopping Ollama server (PID $pid)..."
		kill $pid 2>/dev/null || true
		rm -f data/models/ollama.pid
	else
		echo "No running Ollama PID file found."
	fi
