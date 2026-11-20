package plugin

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"net"
	"net/url"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	sdkproxy "github.com/grafana/grafana-plugin-sdk-go/backend/proxy"
	"github.com/pkg/errors"
	"golang.org/x/net/proxy"
)

func serverNameFromHost(host string) string {
	host = strings.TrimSpace(host)
	if u, err := url.Parse(host); err == nil && u.Hostname() != "" {
		return u.Hostname()
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return host
}

func getTLSConfig(settings Settings) (*tls.Config, error) {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: settings.InsecureSkipVerify,
		ServerName:         serverNameFromHost(settings.Host),
	}
	if settings.TlsClientAuth || settings.TlsAuthWithCACert {
		if settings.TlsAuthWithCACert && len(settings.TlsCACert) > 0 {
			caPool := x509.NewCertPool()
			if ok := caPool.AppendCertsFromPEM([]byte(settings.TlsCACert)); !ok {
				return nil, backend.DownstreamError(ErrorInvalidCACertificate)
			}
			tlsConfig.RootCAs = caPool
		}
		if settings.TlsClientAuth {
			cert, err := tls.X509KeyPair([]byte(settings.TlsClientCert), []byte(settings.TlsClientKey))
			if err != nil {
				return nil, err
			}
			tlsConfig.Certificates = []tls.Certificate{cert}
		}
	}
	return tlsConfig, nil
}

// getPDCDialContext returns a dialer for Grafana's secure SOCKS proxy (PDC) when enabled.
func getPDCDialContext(settings Settings) (func(context.Context, string) (net.Conn, error), error) {
	p := sdkproxy.New(settings.ProxyOptions)

	if !p.SecureSocksProxyEnabled() {
		return nil, nil
	}

	dialer, err := p.NewSecureSocksProxyContextDialer()
	if err != nil {
		return nil, err
	}

	contextDialer, ok := dialer.(proxy.ContextDialer)
	if !ok {
		return nil, errors.New("unable to cast SOCKS proxy dialer to context proxy dialer")
	}

	return func(ctx context.Context, addr string) (net.Conn, error) {
		return contextDialer.DialContext(ctx, "tcp", addr)
	}, nil
}
