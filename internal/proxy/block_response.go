package proxy

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"

	"mitm-proxy/internal/access"
	"mitm-proxy/internal/config"
	"mitm-proxy/internal/policy"
)

// writeBlockedResponse writes a simple HTML block page for policy / intercept
// blocks.
func writeBlockedResponse(w http.ResponseWriter, status int, reason string) {
	if status == 0 {
		status = http.StatusForbidden
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(renderBlockPage(status, reason)))
}

// blockedResponse builds an http.Response carrying a simple HTML block page.
func blockedResponse(reason string) *http.Response {
	body := renderBlockPage(http.StatusForbidden, reason)
	return &http.Response{
		StatusCode: http.StatusForbidden,
		Proto:      "HTTP/1.1",
		ProtoMajor: 1,
		ProtoMinor: 1,
		Header: http.Header{
			"Content-Type":   []string{"text/html; charset=utf-8"},
			"Content-Length": []string{strconv.Itoa(len(body))},
		},
		Body: io.NopCloser(strings.NewReader(body)),
	}
}

func renderBlockPage(status int, reason string) string {
	if strings.TrimSpace(reason) == "" {
		reason = "The proxy blocked this request before it reached the destination."
	}
	reason = htmlEscape(reason)
	statusText := http.StatusText(status)
	if statusText == "" {
		statusText = "Blocked"
	}
	return fmt.Sprintf(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Request blocked</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f3f5f8; color: #121926; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; background: linear-gradient(180deg, rgba(255,255,255,.88), rgba(243,245,248,.94)), radial-gradient(circle at top left, rgba(185, 28, 28, .14), transparent 34rem); }
    main { width: min(640px, 100%%); border: 1px solid #d8dee8; border-radius: 8px; background: #ffffff; box-shadow: 0 24px 70px rgba(18, 25, 38, .14); overflow: hidden; }
    .top { display: flex; gap: 16px; align-items: center; padding: 24px 28px; border-bottom: 1px solid #e4e8ef; background: #fffafa; }
    .mark { width: 44px; height: 44px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%%; background: #b42318; color: #ffffff; font-size: 26px; font-weight: 800; line-height: 1; }
    h1 { margin: 0; font-size: clamp(24px, 4vw, 32px); line-height: 1.1; }
    .subtitle { margin: 7px 0 0; color: #5f6b7a; font-size: 15px; }
    .content { padding: 26px 28px 28px; }
    .reason { border: 1px solid #f1b8b1; border-left: 5px solid #b42318; border-radius: 8px; padding: 16px 18px; background: #fff7f5; }
    .reason strong { display: block; margin-bottom: 6px; color: #7a271a; font-size: 14px; }
    .reason p { margin: 0; color: #3f4652; line-height: 1.55; }
    .footer { margin-top: 18px; color: #667085; font-size: 13px; line-height: 1.45; }
    @media (max-width: 640px) { body { padding: 0; place-items: stretch; } main { min-height: 100vh; border-radius: 0; } .top, .content { padding-left: 20px; padding-right: 20px; } }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div class="mark">!</div>
      <div>
        <h1>Request blocked</h1>
        <p class="subtitle">The proxy blocked this request before it reached the destination.</p>
      </div>
    </div>
    <div class="content">
      <div class="reason">
        <strong>Why this was blocked</strong>
        <p>%s</p>
      </div>
      <p class="footer">HTTP %d. Review the admin dashboard for the audit record.</p>
    </div>
  </main>
</body>
</html>`, reason, status)
}

func accessBlockedResponse(cfg *config.Config, decision access.Decision) *http.Response {
	status, body := access.DeniedPageHTML(cfg, decision)
	return &http.Response{
		StatusCode: status,
		Proto:      "HTTP/1.1",
		ProtoMajor: 1,
		ProtoMinor: 1,
		Header: http.Header{
			"Content-Type":   []string{"text/html; charset=utf-8"},
			"Cache-Control":  []string{"no-store"},
			"Content-Length": []string{strconv.Itoa(len(body))},
		},
		Body: io.NopCloser(strings.NewReader(body)),
	}
}

func writeAccessBlockedResponse(w http.ResponseWriter, cfg *config.Config, decision access.Decision) {
	status, body := access.DeniedPageHTML(cfg, decision)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

func (p *Proxy) checkPolicy(hostPort string) policy.BlockDecision {
	cfg := p.cfg()
	engine := policy.New(cfg.BlockedPorts, cfg.BlockedDomains, cfg.BlockedIPs)
	host := hostPort
	port := 0
	if strings.Contains(hostPort, ":") {
		if h, pstr, err := net.SplitHostPort(hostPort); err == nil {
			host = h
			port, _ = strconv.Atoi(pstr)
		}
	}
	if port > 0 {
		if decision := engine.CheckPort(port); decision.Blocked {
			return decision
		}
	}
	if decision := engine.CheckDomain(host); decision.Blocked {
		return decision
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		return engine.CheckIP(ip)
	}
	if ips, err := net.LookupIP(host); err == nil {
		for _, ip := range ips {
			if decision := engine.CheckIP(ip); decision.Blocked {
				return decision
			}
		}
	}
	return policy.BlockDecision{}
}

func policyDecision(decision access.Decision) policy.BlockDecision {
	return policy.BlockDecision{
		Blocked: true,
		Reason:  decision.Reason,
		RuleID:  defaultString(decision.RuleID, "proxy_auth"),
	}
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func remoteIP(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

func htmlEscape(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&#34;", "'", "&#39;")
	return replacer.Replace(value)
}
