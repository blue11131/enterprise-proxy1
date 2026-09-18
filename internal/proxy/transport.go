package proxy

import (
	"context"
	"net"
	"net/http"
	"time"

	cfgpkg "mitm-proxy/internal/config"

	"golang.org/x/net/http2"
)

// newDirectTransport builds a direct HTTP transport that connects straight
// to the target server (no chained upstream proxy).
func newDirectTransport(cfg *cfgpkg.Config) *http.Transport {
	transport := &http.Transport{
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        cfg.MaxIdleConns,
		IdleConnTimeout:     time.Duration(cfg.IdleConnTimeout) * time.Second,
		TLSHandshakeTimeout: time.Duration(cfg.TLSHandshakeTimeout) * time.Second,
		DialContext:         (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
	}
	_ = http2.ConfigureTransport(transport)
	return transport
}

func newDirectHTTPClient(cfg *cfgpkg.Config, timeout time.Duration) *http.Client {
	client := &http.Client{Transport: newDirectTransport(cfg)}
	if timeout > 0 {
		client.Timeout = timeout
	}
	return client
}

// dialDirect opens a plain TCP connection to target.
func dialDirect(ctx context.Context, target string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	return dialer.DialContext(ctx, "tcp", target)
}
