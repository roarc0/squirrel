package service

import (
	"context"
	"io"

	"connectrpc.com/connect"

	"github.com/roarc0/squirrel/backend/internal/auth"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

type progressWriter struct {
	total      int64
	downloaded int64
	onProgress func(percent int32)
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n := len(p)
	pw.downloaded += int64(n)
	var pct int32
	if pw.total > 0 {
		pct = int32((pw.downloaded * 100) / pw.total)
		if pct > 100 {
			pct = 100
		}
	}
	if pw.onProgress != nil {
		pw.onProgress(pct)
	}
	return n, nil
}

func (s *Server) ExportBackup(ctx context.Context, req *connect.Request[portv1.ExportBackupRequest]) (*connect.Response[portv1.ExportBackupResponse], error) {
	data, filename, err := s.store.ExportBackup(ctx, auth.UserIDOrEmpty(ctx))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.ExportBackupResponse{
		BackupData: data,
		Filename:   filename,
	}), nil
}

func (s *Server) RestoreBackup(ctx context.Context, req *connect.Request[portv1.RestoreBackupRequest]) (*connect.Response[portv1.RestoreBackupResponse], error) {
	userID := auth.UserIDOrEmpty(ctx)
	allowMissingInstruments := s.config.Auth.SessionSecret == ""
	if user, ok := auth.UserFromContext(ctx); ok && s.config.Auth.AdminGoogleID != "" && user.GoogleID == s.config.Auth.AdminGoogleID {
		allowMissingInstruments = true
	}
	if err := s.store.RestoreBackup(ctx, userID, req.Msg.BackupData, allowMissingInstruments); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.RestoreBackupResponse{
		Success: true,
		Message: "Backup restored successfully",
	}), nil
}

// ensure progressWriter satisfies io.Writer
var _ io.Writer = (*progressWriter)(nil)
