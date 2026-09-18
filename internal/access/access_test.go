package access

import (
	"context"
	"encoding/base64"
	"net/http"
	"testing"

	cfgpkg "mitm-proxy/internal/config"
	"mitm-proxy/internal/store"
)

// fakeStore 是 Store 接口的内存实现，用于单元测试。
type fakeStore struct {
	users map[string]store.ProxyUser
	rules []store.ProxyACLRule
	roles map[string][]string
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		users: map[string]store.ProxyUser{},
		rules: []store.ProxyACLRule{},
		roles: map[string][]string{},
	}
}

func (f *fakeStore) GetProxyUserByUsername(_ context.Context, username string) (store.ProxyUser, bool, error) {
	user, ok := f.users[username]
	return user, ok, nil
}

func (f *fakeStore) TouchProxyUserLastUsed(context.Context, string) error { return nil }

func (f *fakeStore) ListProxyACLRules(context.Context) ([]store.ProxyACLRule, error) {
	return f.rules, nil
}

func (f *fakeStore) GetUserRoles(_ context.Context, username string) ([]string, error) {
	if roles, ok := f.roles[username]; ok {
		return roles, nil
	}
	// 兜底：从 user 记录里拿 role
	if user, ok := f.users[username]; ok && user.Role != "" {
		return []string{user.Role}, nil
	}
	return nil, nil
}

// 构造一个简单的测试配置：开启代理认证，不做 loopback 豁免
func testConfig() *cfgpkg.Config {
	cfg := &cfgpkg.Config{}
	cfg.ProxyAuth.Enabled = true
	cfg.ProxyAuth.RequireAuthForLoopback = true
	cfg.ProxyAuth.DefaultAction = "deny"
	cfg.ProxyAuth.Realm = "Test"
	return cfg
}

// 生成 Basic Proxy-Authorization 头
func basicAuth(username, password string) string {
	raw := username + ":" + password
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(raw))
}

// 预置一个用户到 fakeStore
func addUser(fs *fakeStore, username, password, role string) {
	hash, _ := HashPassword(password)
	fs.users[username] = store.ProxyUser{
		ID:           "u-" + username,
		Username:     username,
		PasswordHash: hash,
		Role:         role,
		Enabled:      true,
	}
	fs.roles[username] = []string{role}
}

// ==================== 测试用例 ====================

// 1. 正确密码 -> 放行
func TestAuthorizeCorrectPassword(t *testing.T) {
	fs := newFakeStore()
	addUser(fs, "alice", "secret", "admin")
	fs.rules = []store.ProxyACLRule{
		{
			ID: "r1", Enabled: true, Action: "allow", Priority: 1,
			Users: []string{"alice"},
			HostPatterns: []string{"example.com"},
		},
	}
	ctrl := NewController(func() *cfgpkg.Config { return testConfig() }, fs)

	decision := ctrl.Authorize(
		context.Background(),
		basicAuth("alice", "secret"),
		"10.0.0.1:1234",
		"GET",
		"http://example.com/path",
	)
	if !decision.Allowed {
		t.Fatalf("expected request allowed, got denied: %s", decision.Reason)
	}
	if decision.Username != "alice" {
		t.Fatalf("expected username alice, got %q", decision.Username)
	}
}

// 2. 错误密码 -> 拒绝（401）
func TestAuthorizeWrongPassword(t *testing.T) {
	fs := newFakeStore()
	addUser(fs, "bob", "secret", "guest")
	ctrl := NewController(func() *cfgpkg.Config { return testConfig() }, fs)

	decision := ctrl.Authorize(
		context.Background(),
		basicAuth("bob", "wrong-password"),
		"10.0.0.1:1234",
		"GET",
		"http://example.com/path",
	)
	if decision.Allowed {
		t.Fatal("expected request denied for wrong password")
	}
	if decision.StatusCode != http.StatusProxyAuthRequired {
		t.Fatalf("expected 407, got %d", decision.StatusCode)
	}
}

// 3. 未提供凭证 -> 401
func TestAuthorizeMissingCredentials(t *testing.T) {
	fs := newFakeStore()
	ctrl := NewController(func() *cfgpkg.Config { return testConfig() }, fs)

	decision := ctrl.Authorize(context.Background(), "", "10.0.0.1:1234", "GET", "http://example.com/")
	if decision.Allowed || !decision.AuthNeeded {
		t.Fatalf("expected 407 with AuthNeeded, got allowed=%v authNeeded=%v", decision.Allowed, decision.AuthNeeded)
	}
}

// 4. 不同角色访问同一网站结果不同
//    - admin 角色 -> 允许访问 example.com
//    - guest 角色 -> 拒绝访问 example.com
func TestAuthorizeRoleBasedAccess(t *testing.T) {
	fs := newFakeStore()
	addUser(fs, "admin", "admin-pass", "admin")
	addUser(fs, "guest", "guest-pass", "guest")

	// 规则1：admin 角色可以访问 example.com
	// 规则2：guest 角色访问 example.com 被拒绝
	fs.rules = []store.ProxyACLRule{
		{
			ID: "allow-admin", Enabled: true, Action: "allow", Priority: 1,
			Roles:        []string{"admin"},
			HostPatterns: []string{"example.com"},
		},
		{
			ID: "deny-guest", Enabled: true, Action: "deny", Priority: 2,
			Roles:        []string{"guest"},
			HostPatterns: []string{"example.com"},
		},
	}
	ctrl := NewController(func() *cfgpkg.Config { return testConfig() }, fs)

	// admin 访问 -> 允许
	adminDecision := ctrl.Authorize(
		context.Background(),
		basicAuth("admin", "admin-pass"),
		"10.0.0.1:1234", "GET", "http://example.com/",
	)
	if !adminDecision.Allowed {
		t.Fatalf("admin should be allowed, got %s", adminDecision.Reason)
	}

	// guest 访问 -> 拒绝
	guestDecision := ctrl.Authorize(
		context.Background(),
		basicAuth("guest", "guest-pass"),
		"10.0.0.1:1234", "GET", "http://example.com/",
	)
	if guestDecision.Allowed {
		t.Fatal("guest should be denied by role rule")
	}
}

// 5. 用户级别 ACL：不同用户不同规则
func TestAuthorizeUserSpecificRule(t *testing.T) {
	fs := newFakeStore()
	addUser(fs, "carol", "pw", "user")
	addUser(fs, "dave", "pw", "user")

	fs.rules = []store.ProxyACLRule{
		{
			ID: "allow-carol", Enabled: true, Action: "allow", Priority: 1,
			Users:        []string{"carol"},
			HostPatterns: []string{"only-carol.com"},
		},
	}
	ctrl := NewController(func() *cfgpkg.Config { return testConfig() }, fs)

	carol := ctrl.Authorize(context.Background(), basicAuth("carol", "pw"), "10.0.0.1:1", "GET", "http://only-carol.com/")
	if !carol.Allowed {
		t.Fatalf("carol should be allowed, got %s", carol.Reason)
	}

	dave := ctrl.Authorize(context.Background(), basicAuth("dave", "pw"), "10.0.0.1:1", "GET", "http://only-carol.com/")
	if dave.Allowed {
		t.Fatal("dave should be denied (no matching rule, default deny)")
	}
}