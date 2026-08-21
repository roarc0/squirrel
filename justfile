version := env_var_or_default("VERSION", "dev")

generate:
	cd proto && just generate

ui: generate
	cd ui && npm run build

run *args: ui
	CGO_ENABLED=0 go run ./backend/cmd/loot {{args}}

build: ui
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version={{version}}" -o bin/loot ./backend/cmd/loot

test: ui
	CGO_ENABLED=0 go test ./backend/...
	cd ui && npm run check
	cd ui && npm test
