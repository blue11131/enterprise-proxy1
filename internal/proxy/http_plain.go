package proxy

import (
	"bufio"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"mitm-proxy/internal/access"
	"mitm-proxy/internal/events"
)

// isWebSocketRequest 判断请求是否为 WebSocket 协议升级。
func isWebSocketRequest(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}

	conn := r.Header.Get("Connection")

	for _, part := range strings.Split(conn, ",") {
		if strings.EqualFold(strings.TrimSpace(part), "upgrade") {
			return true
		}
	}

	return false
}

// 逐跳首部只对单次连接有意义，不转发给下一跳。
// Connection 首部中列出的自定义首部也要一并删除，见 stripHopByHopHeaders。
var hopByHopHeaders = []string{
	"Connection",
	"Proxy-Connection",
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"TE",
	"Trailer",
	"Transfer-Encoding",
	"Upgrade",
}

// stripHopByHopHeaders 删除逐跳首部，顺带删除 Connection 首部中显式列出的所有首部。
func stripHopByHopHeaders(h http.Header) {
	if c := h.Get("Connection"); c != "" {
		for _, part := range strings.Split(c, ",") {
			if name := strings.TrimSpace(part); name != "" {
				h.Del(name)
			}
		}
	}

	for _, k := range hopByHopHeaders {
		h.Del(k)
	}
}

// handleHTTP 处理明文 HTTP 请求（以及 ws:// 升级）的完整转发流程：
// 访问控制 → 黑白名单拦截 → 本地缓存 → 上游转发 → 响应回写。
func (p *Proxy) handleHTTP(w http.ResponseWriter, r *http.Request) {
	target := r.URL.String()
	if target == "" || r.URL.Host == "" {
		clone := *r.URL
		if clone.Scheme == "" {
			clone.Scheme = "http"
		}
		if clone.Host == "" {
			clone.Host = r.Host
		}
		target = clone.String()
	}
	decision := p.accessController().AuthorizeRequest(r, target)
	if !decision.Allowed {
		p.publishAccessDenied(r, decision)
		access.WriteDenied(w, p.cfg(), decision)
		return
	}
	// 把认证出来的用户名放进上下文，后续审计事件据此归属到具体用户
	if decision.Username != "" {
		r = r.WithContext(access.WithUsername(r.Context(), decision.Username))
	}

	if isWebSocketRequest(r) {
		p.handleWebSocketHTTP(w, r)

		return
	}

	start := time.Now()
	requestID := requestID(start)

	req := r.Clone(r.Context())
	req = withTrafficID(req, requestID)
	req.RequestURI = ""

	if req.URL.Scheme == "" {
		req.URL.Scheme = "http"
	}

	if req.URL.Host == "" {
		req.URL.Host = r.Host
	}

	stripHopByHopHeaders(req.Header)
	p.publishTrafficStarted(requestID, req, "http/1.1")
	cfg := p.cfg()

	// 黑白名单（端口/域名/IP）拦截
	if decision := checkBlocklist(cfg, req.URL.Host); decision.Blocked {
		p.publishBlocked(requestID, req, decision.RuleID, decision.Reason)
		writeBlockedResponse(w, cfg.BlockResponseStatus, decision.Reason)
		return
	}

	// GET 等可缓存请求优先命中本地缓存
	if p.cache != nil && p.cache.ShouldConsider(req) {
		if cr, hashHex, err := p.cache.LoadContext(req.Context(), req.URL); err == nil && cr != nil {
			p.publish(events.TopicCacheHit, map[string]any{"url": req.URL.String(), "cache_key": hashHex}, requestID)
			cachedResp := &http.Response{StatusCode: cr.Status, Header: cr.Header.Clone(), Body: io.NopCloser(strings.NewReader(""))}
			body := cr.Body

			for k, vals := range cachedResp.Header {
				for _, v := range vals {
					w.Header().Add(k, v)
				}
			}

			// 标记该响应由本地缓存提供
			w.Header().Set("Via", p.cfg().ProxyName)

			// 附加一个由代理名派生的 UID 响应头，值为缓存文件哈希
			uidHeader := p.makeCustomHeader("uid")

			w.Header().Set(uidHeader, hashHex)
			w.WriteHeader(cachedResp.StatusCode)
			n, _ := w.Write(body)
			dur := time.Since(start)

			p.logRequest("CACHE HIT HTTP %s %s -> status=%d, bytes=%d, dur=%s", r.Method, req.URL.String(), cr.Status, n, dur)
			p.publishTrafficCompleted(requestID, req, cachedResp.StatusCode, n, dur, true, cachedResp.Header)

			return
		}
		p.publish(events.TopicCacheMiss, map[string]any{"url": req.URL.String()}, requestID)
	}

	resp, err := p.httpClient().Do(req)

	if err != nil {
		log.Printf("HTTP proxy error: %v", err)
		http.Error(w, "proxy error", http.StatusBadGateway)

		return
	}

	defer resp.Body.Close()

	stripHopByHopHeaders(resp.Header)

	// 写入缓存的响应整体读入内存
	var bodyBuf []byte

	if p.cache != nil && p.cache.ShouldConsider(req) {
		bodyBuf, _ = io.ReadAll(resp.Body)

		for k, vals := range resp.Header {
			for _, v := range vals {
				w.Header().Add(k, v)
			}
		}

		w.WriteHeader(resp.StatusCode)
		n, _ := w.Write(bodyBuf)
		p.cache.SaveContext(req.Context(), req.URL, resp, bodyBuf)
		dur := time.Since(start)

		p.logRequest("HTTP %s %s -> status=%d, bytes=%d, dur=%s (cached)", r.Method, req.URL.String(), resp.StatusCode, n, dur)
		p.publishTrafficCompleted(requestID, req, resp.StatusCode, n, dur, false, resp.Header)

		return
	}

	// 不入缓存的响应直接流式转发
	for k, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}

	w.WriteHeader(resp.StatusCode)
	n, _ := io.Copy(w, resp.Body)

	dur := time.Since(start)

	p.logRequest("HTTP %s %s -> status=%d, bytes=%d, dur=%s", r.Method, req.URL.String(), resp.StatusCode, n, dur)
	p.publishTrafficCompleted(requestID, req, resp.StatusCode, n, dur, false, resp.Header)
}

// handleWebSocketHTTP 建立 ws:// 的透明隧道：
// 拿到 101 响应后，客户端与上游之间的字节流由 relayWebSocket 双向搬运。
func (p *Proxy) handleWebSocketHTTP(w http.ResponseWriter, r *http.Request) {
	hj, ok := w.(http.Hijacker)

	if !ok {
		http.Error(w, "websocket proxy: hijacking not supported", http.StatusInternalServerError)

		return
	}

	clientConn, buf, err := hj.Hijack()

	if err != nil {
		log.Printf("websocket hijack error: %v", err)

		return
	}

	targetHost := r.URL.Host

	if targetHost == "" {
		targetHost = r.Host
	}

	if !strings.Contains(targetHost, ":") {
		targetHost = net.JoinHostPort(targetHost, "80")
	}
	// 认证信息只用于代理自身，不能透传给上游
	r.Header.Del("Proxy-Authorization")
	stripWebSocketCompression(r.Header)

	upstreamConn, err := dialDirect(r.Context(), targetHost)

	if err != nil {
		log.Printf("websocket upstream dial error: %v", err)

		clientConn.Close()

		return
	}

	if err := r.Write(upstreamConn); err != nil {
		log.Printf("websocket write request to upstream error: %v", err)

		clientConn.Close()
		upstreamConn.Close()

		return
	}

	upstreamReader := bufio.NewReader(upstreamConn)
	resp, err := http.ReadResponse(upstreamReader, r)

	if err != nil {
		log.Printf("websocket read response from upstream error: %v", err)

		clientConn.Close()
		upstreamConn.Close()

		return
	}

	// 101 响应体通常为空，但仍要关闭以免连接泄漏
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusSwitchingProtocols {
		log.Printf("websocket upgrade failed: status=%d", resp.StatusCode)

		_ = resp.Write(clientConn)
		clientConn.Close()
		upstreamConn.Close()

		return
	}

	if err := resp.Write(clientConn); err != nil {
		log.Printf("websocket write response to client error: %v", err)

		clientConn.Close()
		upstreamConn.Close()

		return
	}

	p.logVerbose("ws tunnel established %s <-> %s", clientConn.RemoteAddr(), targetHost)
	// 客户端一侧沿用 Hijack 返回的缓冲读取器
	relayWebSocket(clientConn, buf.Reader, upstreamConn, upstreamReader)
}
