version := env_var_or_default("VERSION", "dev")

ui:
    cd ui && npm ci && npm run build

run *args: ui
    CGO_ENABLED=0 go run . {{args}}

build: ui
    mkdir -p bin
    CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version={{version}}" -o bin/loot .

test: ui
    CGO_ENABLED=0 go test ./...
    cd ui && npm run check
    cd ui && npm test
