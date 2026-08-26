package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type ChatMessageRecord struct {
	ID            string    `json:"id"`
	SessionID     string    `json:"session_id"`
	UserID        string    `json:"user_id"`
	Role          string    `json:"role"`
	Content       string    `json:"content"`
	Timestamp     string    `json:"timestamp"`
	ToolCallsJSON string    `json:"tool_calls_json"`
	CreatedAt     time.Time `json:"created_at"`
}

type ChatSessionRecord struct {
	ID           string              `json:"id"`
	UserID       string              `json:"user_id"`
	Title        string              `json:"title"`
	CreatedAt    time.Time           `json:"created_at"`
	UpdatedAt    time.Time           `json:"updated_at"`
	Messages     []ChatMessageRecord `json:"messages"`
	MessageCount int                 `json:"message_count"`
}

func (s *Store) ListChatSessions(ctx context.Context, userID string) ([]ChatSessionRecord, error) {
	query := `
		SELECT s.id, s.user_id, s.title, s.created_at, s.updated_at, COUNT(m.id) as message_count
		FROM chat_sessions s
		LEFT JOIN chat_messages m ON s.id = m.session_id
		WHERE s.user_id = ?
		GROUP BY s.id
		ORDER BY s.updated_at DESC
	`
	rows, err := s.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("query chat sessions: %w", err)
	}
	defer rows.Close()

	var sessions []ChatSessionRecord
	for rows.Next() {
		var sRec ChatSessionRecord
		var count int
		if err := rows.Scan(&sRec.ID, &sRec.UserID, &sRec.Title, &sRec.CreatedAt, &sRec.UpdatedAt, &count); err != nil {
			return nil, fmt.Errorf("scan chat session: %w", err)
		}
		sRec.MessageCount = count
		sessions = append(sessions, sRec)
	}
	return sessions, rows.Err()
}

func (s *Store) GetChatSession(ctx context.Context, id string, userID string) (*ChatSessionRecord, error) {
	var sRec ChatSessionRecord
	err := s.db.QueryRowContext(ctx, `SELECT id, user_id, title, created_at, updated_at FROM chat_sessions WHERE id = ? AND user_id = ?`, id, userID).
		Scan(&sRec.ID, &sRec.UserID, &sRec.Title, &sRec.CreatedAt, &sRec.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get chat session: %w", err)
	}

	rows, err := s.db.QueryContext(ctx, `SELECT id, session_id, user_id, role, content, timestamp, tool_calls_json, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`, id)
	if err != nil {
		return nil, fmt.Errorf("query chat messages: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var msg ChatMessageRecord
		if err := rows.Scan(&msg.ID, &msg.SessionID, &msg.UserID, &msg.Role, &msg.Content, &msg.Timestamp, &msg.ToolCallsJSON, &msg.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan chat message: %w", err)
		}
		if msg.Role == "assistant" && len(msg.Content) == 0 && len(msg.ToolCallsJSON) == 0 {
			continue
		}
		sRec.Messages = append(sRec.Messages, msg)
	}
	sRec.MessageCount = len(sRec.Messages)
	return &sRec, rows.Err()
}

func (s *Store) SaveChatSession(ctx context.Context, session *ChatSessionRecord) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			updated_at = excluded.updated_at
	`, session.ID, session.UserID, session.Title, now, now)
	if err != nil {
		return fmt.Errorf("upsert chat session: %w", err)
	}

	// Delete old messages to replace with current message history
	if _, err := tx.ExecContext(ctx, `DELETE FROM chat_messages WHERE session_id = ?`, session.ID); err != nil {
		return fmt.Errorf("delete old chat messages: %w", err)
	}

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO chat_messages (id, session_id, user_id, role, content, timestamp, tool_calls_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare insert chat message: %w", err)
	}
	defer stmt.Close()

	for i, msg := range session.Messages {
		if msg.Role == "assistant" && len(msg.Content) == 0 && len(msg.ToolCallsJSON) == 0 {
			continue
		}
		msgID := msg.ID
		if msgID == "" {
			msgID = fmt.Sprintf("%s-%d", session.ID, i)
		}
		createdAt := msg.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		if _, err := stmt.ExecContext(ctx, msgID, session.ID, session.UserID, msg.Role, msg.Content, msg.Timestamp, msg.ToolCallsJSON, createdAt); err != nil {
			return fmt.Errorf("insert chat message: %w", err)
		}
	}

	return tx.Commit()
}

func (s *Store) DeleteChatSession(ctx context.Context, id string, userID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM chat_sessions WHERE id = ? AND user_id = ?`, id, userID)
	return err
}
