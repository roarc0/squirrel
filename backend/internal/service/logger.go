package service

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/mattn/go-isatty"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

const (
	ansiReset  = "\033[0m"
	ansiBold   = "\033[1m"
	ansiRed    = "\033[31m"
	ansiGreen  = "\033[32m"
	ansiYellow = "\033[33m"
	ansiCyan   = "\033[36m"
	ansiGray   = "\033[90m"
	ansiWhite  = "\033[97m"
)

var colorOutput = isatty.IsTerminal(os.Stderr.Fd()) || isatty.IsCygwinTerminal(os.Stderr.Fd())

func color(s, code string) string {
	if !colorOutput {
		return s
	}
	return code + s + ansiReset
}

func newRequestLogger() *zap.Logger {
	enc := zapcore.EncoderConfig{
		TimeKey:        "T",
		LevelKey:       "",
		MessageKey:     "M",
		EncodeTime:     zapcore.TimeEncoderOfLayout("15:04:05.000"),
		EncodeDuration: zapcore.StringDurationEncoder,
	}
	core := zapcore.NewCore(
		zapcore.NewConsoleEncoder(enc),
		zapcore.AddSync(os.Stderr),
		zapcore.InfoLevel,
	)
	return zap.New(core)
}

type responseCapture struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (rc *responseCapture) WriteHeader(code int) {
	rc.status = code
	rc.ResponseWriter.WriteHeader(code)
}

func (rc *responseCapture) Write(b []byte) (int, error) {
	if rc.status == 0 {
		rc.status = http.StatusOK
	}
	n, err := rc.ResponseWriter.Write(b)
	rc.bytes += n
	return n, err
}

func (rc *responseCapture) Flush() {
	if f, ok := rc.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func requestLoggingMiddleware(log *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip UI static assets
			if r.URL.Path == "/" || strings.HasPrefix(r.URL.Path, "/assets/") {
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			rc := &responseCapture{ResponseWriter: w}
			next.ServeHTTP(rc, r)

			status := rc.status
			if status == 0 {
				status = http.StatusOK
			}
			dur := time.Since(start)

			log.Info(fmt.Sprintf("%s %s %s %s %s",
				color(fmt.Sprintf("%-7s", r.Method), ansiCyan+ansiBold),
				color(r.URL.Path, ansiWhite),
				colorStatus(status),
				colorLatency(dur),
				color(fmt.Sprintf("%dB", rc.bytes), ansiGray),
			))
		})
	}
}

func colorStatus(code int) string {
	s := fmt.Sprintf("%d", code)
	switch {
	case code >= 500:
		return color(s, ansiRed+ansiBold)
	case code >= 400:
		return color(s, ansiYellow)
	case code >= 300:
		return color(s, ansiCyan)
	default:
		return color(s, ansiGreen)
	}
}

func colorLatency(d time.Duration) string {
	s := d.Round(time.Microsecond).String()
	switch {
	case d > 500*time.Millisecond:
		return color(s, ansiRed)
	case d > 100*time.Millisecond:
		return color(s, ansiYellow)
	default:
		return color(s, ansiGreen)
	}
}
