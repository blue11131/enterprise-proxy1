package config

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"strings"
)

// Config holds runtime configuration for the proxy.
type Config struct {
	// Server settings
	ListenAddr string `json:"listen_addr"`

	// CA certificate paths
	CACertPath string `json:"ca_cert_path"`
	CAKeyPath  string `json:"ca_key_path"`

	// Output paths for generated certificates
	CACertOutputPath string `json:"ca_cert_output_path"`
	CAKeyOutputPath  string `json:"ca_key_output_path"`

	// MITM settings
	EnableMITM bool `json:"enable_mitm"`

	// Domain exclusions (supports wildcards)
	ExcludedDomains []string `json:"excluded_domains"`

	// Logging
	VerboseLogging bool `json:"verbose_logging"`
	LogRequests    bool `json:"log_requests"`

	// Connection settings
	MaxIdleConns        int `json:"max_idle_conns"`
	IdleConnTimeout     int `json:"idle_conn_timeout_seconds"`
	TLSHandshakeTimeout int `json:"tls_handshake_timeout_seconds"`

	// TLS settings
	MinTLSVersion string   `json:"min_tls_version"`
	TLSNextProtos []string `json:"tls_next_protos"`

	// Proxy identity
	ProxyName string `json:"proxy_name"`

	// Admin dashboard
	AdminEnabled   bool   `json:"admin_enabled"`
	AdminAddr      string `json:"admin_addr"`
	AdminToken     string `json:"admin_token"`
	AdminReadToken string `json:"admin_read_token"`
	AdminUI        bool   `json:"admin_ui"`
	AdminStore     string `json:"admin_store"`

	// Caching (nested)
	Cache CacheConfig `json:"cache"`

	// Blocking policy
	BlockedPorts        []int    `json:"blocked_ports"`
	BlockedDomains      []string `json:"blocked_domains"`
	BlockedIPs          []string `json:"blocked_ips"`
	BlockAction         string   `json:"block_action"`
	BlockResponseStatus int      `json:"block_response_status"`

	// ProxyAuth controls client authentication and ACL enforcement for proxy traffic.
	ProxyAuth ProxyAuthConfig `json:"proxy_auth"`

	// Traffic capture controls body persistence for dashboard inspection.
	TrafficCapture TrafficCaptureConfig `json:"traffic_capture"`

	// Deprecated legacy flat caching fields (supported for backward compatibility)
	CacheEnabledLegacy      bool     `json:"cache_enabled"`
	CacheDirLegacy          string   `json:"cache_dir"`
	IncludeDomainsLegacy    []string `json:"include_domains"`
	ExcludeDomainsLegacy    []string `json:"exclude_domains"`
	IncludeExtensionsLegacy []string `json:"include_extensions"`
	ExcludeExtensionsLegacy []string `json:"exclude_extensions"`
	CacheTTLLegacy          int      `json:"cache_ttl"`
}

// CacheConfig holds cache-related configuration
type CacheConfig struct {
	Enabled           bool     `json:"enabled"`
	Directory         string   `json:"directory"`
	IncludeDomains    []string `json:"include_domains"`
	ExcludeDomains    []string `json:"exclude_domains"`
	IncludeExtensions []string `json:"include_extensions"`
	ExcludeExtensions []string `json:"exclude_extensions"`
	TTL               int      `json:"ttl"`
}

type ProxyAuthConfig struct {
	Enabled                bool   `json:"enabled"`
	Realm                  string `json:"realm"`
	RequireAuthForLoopback bool   `json:"require_auth_for_loopback"`
	DefaultAction          string `json:"default_action"`
}

type TrafficCaptureConfig struct {
	StoreBodies     bool     `json:"store_bodies"`
	MaxBodyBytes    int64    `json:"max_body_bytes"`
	RedactBodies    bool     `json:"redact_bodies"`
	StoreHeaders    bool     `json:"store_headers"`
	RedactedHeaders []string `json:"redacted_headers"`
	StoreCookies    bool     `json:"store_cookies"`
	RedactedCookies []string `json:"redacted_cookies"`
}

// defaultConfig returns a Config with sensible defaults.
func defaultConfig() *Config {
	return &Config{
		ListenAddr:          ":8080",
		CACertPath:          "",
		CAKeyPath:           "",
		CACertOutputPath:    "ca-cert.pem",
		CAKeyOutputPath:     "ca-key.pem",
		EnableMITM:          true,
		ExcludedDomains:     nil,
		VerboseLogging:      false,
		LogRequests:         true,
		MaxIdleConns:        200,
		IdleConnTimeout:     90,
		TLSHandshakeTimeout: 10,
		MinTLSVersion:       "1.2",
		TLSNextProtos:       []string{"h2", "http/1.1"},
		ProxyName:           "MITM-Proxy",
		AdminEnabled:        true,
		AdminAddr:           "127.0.0.1:9090",
		AdminUI:             true,
		AdminStore:          "dashboard.db",
		BlockAction:         "deny",
		BlockResponseStatus: 403,
		// Caching defaults
		Cache: CacheConfig{
			Enabled:   false,
			Directory: "cache",
			TTL:       3600,
		},
		ProxyAuth:     defaultProxyAuthConfig(),
		TrafficCapture: TrafficCaptureConfig{
			StoreBodies:     false,
			MaxBodyBytes:    32768,
			RedactBodies:    true,
			StoreHeaders:    true,
			RedactedHeaders: defaultRedactedHeaders(),
			StoreCookies:    true,
		},
	}
}

func defaultProxyAuthConfig() ProxyAuthConfig {
	return ProxyAuthConfig{
		Enabled:                false,
		Realm:                  "MITM Proxy",
		RequireAuthForLoopback: false,
		DefaultAction:          "",
	}
}

// Load reads configuration from path or config.json, falling back to defaults.
func Load(path string) (*Config, error) {
	cfg := defaultConfig()

	if path == "" {
		if _, err := os.Stat("config.json"); err == nil {
			path = "config.json"
		} else {
			log.Println("No config file specified or found, using defaults")
			if err := cfg.NormalizeAndValidate(); err != nil {
				return nil, err
			}
			return cfg, nil
		}
	}

	data, err := os.ReadFile(path)

	if err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}

	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config file: %w", err)
	}

	if err := cfg.NormalizeAndValidate(); err != nil {
		return nil, err
	}

	log.Printf("Loaded configuration from %s", path)

	return cfg, nil
}

// NormalizeAndValidate applies runtime defaults, migrates legacy fields, and
// rejects invalid combinations in one shared path for file and admin updates.
func (c *Config) NormalizeAndValidate() error {
	if c == nil {
		return fmt.Errorf("invalid config: config is nil")
	}

	// If nested cache object is not populated but legacy fields are present, migrate them
	if isZeroCache(c.Cache) && hasAnyLegacyCache(*c) {
		migrateLegacyToCache(c)
	}

	// Fill defaults for cache if missing
	if c.Cache.Directory == "" {
		c.Cache.Directory = "cache"
	}

	if c.Cache.TTL == 0 {
		c.Cache.TTL = 3600
	}

	applyProxyAuthDefaults(&c.ProxyAuth)
	applyTrafficCaptureDefaults(&c.TrafficCapture)

	if strings.TrimSpace(c.AdminAddr) == "" {
		c.AdminAddr = "127.0.0.1:9090"
	}

	if strings.TrimSpace(c.AdminStore) == "" {
		c.AdminStore = "dashboard.db"
	}

	if c.BlockAction == "" {
		c.BlockAction = "deny"
	}

	if c.BlockResponseStatus == 0 {
		c.BlockResponseStatus = 403
	}

	// Default proxy name if missing
	if strings.TrimSpace(c.ProxyName) == "" {
		c.ProxyName = "MITM-Proxy"
	}

	// Validate mutual exclusivity for include/exclude settings (nested cache)
	if len(c.Cache.IncludeDomains) > 0 && len(c.Cache.ExcludeDomains) > 0 {
		return fmt.Errorf("invalid config: cache.include_domains and cache.exclude_domains cannot both be set")
	}

	if len(c.Cache.IncludeExtensions) > 0 && len(c.Cache.ExcludeExtensions) > 0 {
		return fmt.Errorf("invalid config: cache.include_extensions and cache.exclude_extensions cannot both be set")
	}

	if err := c.ValidateProxyAuth(); err != nil {
		return err
	}

	return nil
}

func applyProxyAuthDefaults(c *ProxyAuthConfig) {
	defaults := defaultProxyAuthConfig()
	if c.Realm == "" {
		c.Realm = defaults.Realm
	}
	if c.DefaultAction == "" {
		if c.Enabled {
			c.DefaultAction = "deny"
		} else {
			c.DefaultAction = "allow"
		}
	}
}

func (c *Config) ValidateProxyAuth() error {
	action := strings.ToLower(strings.TrimSpace(c.ProxyAuth.DefaultAction))
	if action == "" {
		return nil
	}
	if action != "allow" && action != "deny" {
		return fmt.Errorf("invalid config: proxy_auth.default_action must be allow or deny")
	}
	if strings.ContainsAny(c.ProxyAuth.Realm, "\r\n\"") {
		return fmt.Errorf("invalid config: proxy_auth.realm must not contain quotes or newlines")
	}
	return nil
}

func applyTrafficCaptureDefaults(c *TrafficCaptureConfig) {
	if c.MaxBodyBytes == 0 {
		c.MaxBodyBytes = 32768
	}
	if c.RedactedHeaders == nil {
		c.RedactedHeaders = defaultRedactedHeaders()
	}
	c.RedactedHeaders = cleanStringList(c.RedactedHeaders)
	c.RedactedCookies = cleanStringList(c.RedactedCookies)
	if !c.StoreBodies {
		c.RedactBodies = true
	}
}

func defaultRedactedHeaders() []string {
	return []string{
		"Authorization",
		"Cookie",
		"Proxy-Authorization",
		"Set-Cookie",
		"X-Api-Key",
	}
}

func cleanStringList(values []string) []string {
	if values == nil {
		return nil
	}
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	return out
}

// isZeroCache reports whether all fields of CacheConfig are zero-values
func isZeroCache(c CacheConfig) bool {
	return !c.Enabled && c.Directory == "" && c.TTL == 0 && len(c.IncludeDomains) == 0 && len(c.ExcludeDomains) == 0 && len(c.IncludeExtensions) == 0 && len(c.ExcludeExtensions) == 0
}

// hasAnyLegacyCache reports whether any legacy cache field was provided
func hasAnyLegacyCache(c Config) bool {
	return c.CacheEnabledLegacy || c.CacheDirLegacy != "" || c.CacheTTLLegacy != 0 || len(c.IncludeDomainsLegacy) > 0 || len(c.ExcludeDomainsLegacy) > 0 || len(c.IncludeExtensionsLegacy) > 0 || len(c.ExcludeExtensionsLegacy) > 0
}

// migrateLegacyToCache copies legacy flat fields into the nested Cache object
func migrateLegacyToCache(cfg *Config) {
	cfg.Cache.Enabled = cfg.CacheEnabledLegacy

	if cfg.CacheDirLegacy != "" {
		cfg.Cache.Directory = cfg.CacheDirLegacy
	}

	if cfg.CacheTTLLegacy != 0 {
		cfg.Cache.TTL = cfg.CacheTTLLegacy
	}

	if len(cfg.IncludeDomainsLegacy) > 0 {
		cfg.Cache.IncludeDomains = cfg.IncludeDomainsLegacy
	}

	if len(cfg.ExcludeDomainsLegacy) > 0 {
		cfg.Cache.ExcludeDomains = cfg.ExcludeDomainsLegacy
	}

	if len(cfg.IncludeExtensionsLegacy) > 0 {
		cfg.Cache.IncludeExtensions = cfg.IncludeExtensionsLegacy
	}

	if len(cfg.ExcludeExtensionsLegacy) > 0 {
		cfg.Cache.ExcludeExtensions = cfg.ExcludeExtensionsLegacy
	}
}

// GetTLSVersion converts MinTLSVersion to tls package constant.
func (c *Config) GetTLSVersion() uint16 {
	switch c.MinTLSVersion {
	case "1.0":
		return tls.VersionTLS10
	case "1.1":
		return tls.VersionTLS11
	case "1.2":
		return tls.VersionTLS12
	case "1.3":
		return tls.VersionTLS13
	default:
		return tls.VersionTLS12
	}
}

// IsDomainExcluded checks a domain against the exclusion list (supports wildcard patterns like *.example.com).
func (c *Config) IsDomainExcluded(domain string) bool {
	if len(c.ExcludedDomains) == 0 {
		return false
	}

	domain = strings.ToLower(domain)

	if strings.Contains(domain, ":") {
		if host, _, err := net.SplitHostPort(domain); err == nil {
			domain = host
		}
	}

	for _, pattern := range c.ExcludedDomains {
		pattern = strings.ToLower(pattern)

		if strings.HasPrefix(pattern, "*.") {
			suffix := pattern[1:]
			if strings.HasSuffix(domain, suffix) || domain == pattern[2:] {
				return true
			}
		} else if pattern == domain {
			return true
		}
	}

	return false
}

