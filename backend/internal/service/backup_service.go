package service

import (
	"context"
	"errors"
	"io"

	"connectrpc.com/connect"

	portv1 "loot/proto/gen/go/v1"
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
	data, filename, err := s.store.ExportBackup(ctx, s.store.DBPath())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.ExportBackupResponse{
		BackupTarGz: data,
		Filename:    filename,
	}), nil
}

func (s *Server) RestoreBackup(ctx context.Context, req *connect.Request[portv1.RestoreBackupRequest]) (*connect.Response[portv1.RestoreBackupResponse], error) {
	if len(req.Msg.BackupTarGz) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("backup data is empty"))
	}
	if err := s.store.RestoreBackup(ctx, s.store.DBPath(), req.Msg.BackupTarGz); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.RestoreBackupResponse{
		Success: true,
		Message: "Database restored successfully",
	}), nil
}

// ensure progressWriter satisfies io.Writer
var _ io.Writer = (*progressWriter)(nil)
