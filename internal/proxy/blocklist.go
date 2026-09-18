package proxy

import (
	"net"
	"net/url"
	"strconv"
	"strings"

	cfgpkg "mitm-proxy/internal/config"
	"mitm-proxy/internal/policy"
)

// checkBlocklist 把请求目标交给 internal/policy 的黑名单引擎判定。
//
// internal/policy 只提供与配置无关的规则匹配（端口/域名/IP 三项），
// 这里的职责是它外面那层：拆分 host:port，并在确实配了 IP 规则时
// 才做主机名解析——解析会走 DNS，属于代理侧的事，不放进规则引擎。
func checkBlocklist(cfg *cfgpkg.Config, hostPort string) policy.BlockDecision {
	engine := policy.New(cfg.BlockedPorts, cfg.BlockedDomains, cfg.BlockedIPs)
	host := hostPort
	port := 0
	if strings.Contains(hostPort, ":") {
		if parsed, err := url.Parse("//" + hostPort); err == nil {
			host = parsed.Hostname()
			if parsed.Port() != "" {
				port, _ = strconv.Atoi(parsed.Port())
			}
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
	// IP 黑名单：仅在配置了规则时才做主机名解析
	if len(cfg.BlockedIPs) > 0 {
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
	}
	return policy.BlockDecision{}
}
