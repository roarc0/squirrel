module loot/backend

go 1.23.0

require (
	connectrpc.com/connect v1.18.1
	connectrpc.com/cors v0.1.0
	github.com/mattn/go-sqlite3 v1.14.28
	github.com/pressly/goose/v3 v3.24.1
	golang.org/x/net v0.35.0
	google.golang.org/protobuf v1.36.5
	gopkg.in/yaml.v3 v3.0.1
	loot/proto v0.0.0
	loot/ui v0.0.0
)

replace loot/proto => ../proto
replace loot/ui => ../ui
