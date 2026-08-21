package service

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	portv1 "loot/proto/gen/go/v1"
)

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
