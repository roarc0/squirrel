module github.com/roarc0/squirrel/backend

go 1.26.6

require (
	connectrpc.com/connect v1.21.0
	connectrpc.com/cors v0.1.0
	github.com/PuerkitoBio/goquery v1.13.0
	github.com/mattn/go-isatty v0.0.24
	github.com/pressly/goose/v3 v3.28.0
	github.com/roarc0/squirrel/proto v0.0.0
	github.com/roarc0/squirrel/ui v0.0.0
	go.uber.org/zap v1.28.0
	go.yaml.in/yaml/v3 v3.0.5
	golang.org/x/net v0.59.0
	golang.org/x/oauth2 v0.37.0
	google.golang.org/protobuf v1.36.12
	modernc.org/sqlite v1.60.1
)

require (
	cloud.google.com/go/compute/metadata v0.10.0 // indirect
	github.com/andybalholm/cascadia v1.3.5 // indirect
	github.com/dustin/go-humanize v1.1.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/mfridman/interpolate v0.0.2 // indirect
	github.com/ncruces/go-strftime v1.1.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/sethvargo/go-retry v0.4.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/sync v0.23.0 // indirect
	golang.org/x/sys v0.48.0 // indirect
	golang.org/x/text v0.42.0 // indirect
	modernc.org/libc v1.77.1 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.12.1 // indirect
)

replace github.com/roarc0/squirrel/proto => ../proto

replace github.com/roarc0/squirrel/ui => ../ui
