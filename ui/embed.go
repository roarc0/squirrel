package ui

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed dist
var files embed.FS

func Handler() http.Handler {
	dist, err := fs.Sub(files, "dist")
	if err != nil {
		panic(err)
	}
	server := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if _, err := fs.Stat(dist, path); err != nil {
				r.URL.Path = "/"
			}
		}
		if strings.HasPrefix(path, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		server.ServeHTTP(w, r)
	})
}
