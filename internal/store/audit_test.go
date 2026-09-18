package store

import (
	"context"
	"testing"
)

// 使用临时数据库文件，测试结束后自动清理
func newTestStore(t *testing.T) *Store {
	t.Helper()
	path := t.TempDir() + "/test.db"
	s, err := Open(path)
	if err != nil {
		t.Fatalf("open test store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// 1. 写入一条审计日志，然后查询出来验证字段
func TestAddAndListAudit(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	details := map[string]any{
		"host":   "example.com",
		"method": "GET",
		"rule":   "allow-admin",
	}

	if err := s.AddAudit(ctx, "alice", "proxy.request.allowed", details, "10.0.0.1"); err != nil {
		t.Fatalf("add audit: %v", err)
	}

	entries, err := s.ListAudit(ctx, 10)
	if err != nil {
		t.Fatalf("list audit: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 audit entry, got %d", len(entries))
	}

	got := entries[0]
	if got.Actor != "alice" {
		t.Fatalf("actor mismatch: %q", got.Actor)
	}
	if got.Action != "proxy.request.allowed" {
		t.Fatalf("action mismatch: %q", got.Action)
	}
	if got.RemoteIP != "10.0.0.1" {
		t.Fatalf("remote_ip mismatch: %q", got.RemoteIP)
	}
	if len(got.Details) == 0 {
		t.Fatal("expected details JSON, got empty")
	}
}

// 2. 查询顺序：按 id 倒序（最新的在最前）
func TestListAuditOrder(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	for _, actor := range []string{"first", "second", "third"} {
		if err := s.AddAudit(ctx, actor, "test.action", nil, ""); err != nil {
			t.Fatalf("add audit %s: %v", actor, err)
		}
	}

	entries, err := s.ListAudit(ctx, 10)
	if err != nil {
		t.Fatalf("list audit: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	if entries[0].Actor != "third" {
		t.Fatalf("expected latest entry first, got %q", entries[0].Actor)
	}
	if entries[2].Actor != "first" {
		t.Fatalf("expected oldest entry last, got %q", entries[2].Actor)
	}
}

// 3. limit 参数生效
func TestListAuditLimit(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		if err := s.AddAudit(ctx, "user", "test.action", nil, ""); err != nil {
			t.Fatalf("add audit: %v", err)
		}
	}

	entries, err := s.ListAudit(ctx, 2)
	if err != nil {
		t.Fatalf("list audit: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
}

// 4. 空 store（新库）查询不报错，返回空切片
func TestListAuditEmpty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	entries, err := s.ListAudit(ctx, 10)
	if err != nil {
		t.Fatalf("list audit empty: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected 0 entries, got %d", len(entries))
	}
}