package redact

import (
	"net/http"
	"regexp"
	"strings"
)

var (
	jwtRE        = regexp.MustCompile(`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`)
	apiKeyRE     = regexp.MustCompile(`(?i)(api[_-]?key|token|secret|password|passwd|pwd)["'\s:=]+[A-Za-z0-9._~+/=-]{8,}`)
	emailRE      = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	creditCardRE = regexp.MustCompile(`\b(?:\d[ -]*?){13,19}\b`)
)

// RedactHeaders 返回一份脱敏后的首部副本：敏感首部整体替换为 [REDACTED]。
func RedactHeaders(headers http.Header) http.Header {
	out := make(http.Header, len(headers))
	for k, vals := range headers {
		if isSensitiveHeader(k) {
			out[k] = []string{"[REDACTED]"}
			continue
		}
		out[k] = append([]string(nil), vals...)
	}
	return out
}

// RedactBody 对请求/响应体做脱敏，替换 JWT、密钥口令、邮箱与银行卡号。
func RedactBody(body []byte) []byte {
	redacted := append([]byte(nil), body...)
	apply := func(re *regexp.Regexp, replacement []byte) {
		if re.Match(redacted) {
			redacted = re.ReplaceAll(redacted, replacement)
		}
	}
	apply(jwtRE, []byte("[REDACTED_JWT]"))
	apply(apiKeyRE, []byte("$1=[REDACTED]"))
	apply(emailRE, []byte("[REDACTED_EMAIL]"))
	apply(creditCardRE, []byte("[REDACTED_CARD]"))
	return redacted
}

func isSensitiveHeader(header string) bool {
	switch strings.ToLower(http.CanonicalHeaderKey(header)) {
	case "authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization":
		return true
	default:
		return false
	}
}
