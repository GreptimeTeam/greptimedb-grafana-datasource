package plugin

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"testing"
	"time"
)

const testTLSHostname = "greptime.local"

func TestServerNameFromHost(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"https://greptime.local:443", testTLSHostname},
		{"https://greptime.local", testTLSHostname},
		{"greptime.local:4000", testTLSHostname},
		{"greptime.local", testTLSHostname},
		{"  https://greptime.local:443/v1  ", testTLSHostname},
	}
	for _, tc := range cases {
		if got := serverNameFromHost(tc.in); got != tc.want {
			t.Errorf("serverNameFromHost(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestCustomCA_URLHost_Handshake(t *testing.T) {
	caPEM, serverCert, serverKey := mustTestCerts(t)
	addr := startTLSServer(t, serverCert, serverKey)

	settings := Settings{
		Host:              "https://" + testTLSHostname + ":443",
		Secure:            true,
		TlsAuthWithCACert: true,
		TlsCACert:         string(caPEM),
	}

	cfg, err := getTLSConfig(settings)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ServerName != testTLSHostname {
		t.Fatalf("ServerName = %q, want %q", cfg.ServerName, testTLSHostname)
	}

	if err := httpGetTLS(addr, cfg); err != nil {
		t.Fatalf("custom CA + URL Host handshake failed: %v", err)
	}
}

func TestNonCustomCA_HTTPS_Handshake(t *testing.T) {
	caPEM, serverCert, serverKey := mustTestCerts(t)
	addr := startTLSServer(t, serverCert, serverKey)

	ds := &GreptimeDatasource{
		settings: Settings{
			Host:   "https://" + testTLSHostname + ":443",
			Secure: true,
		},
	}
	cfg, err := ds.tlsConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg == nil {
		t.Fatal("expected non-nil tls.Config for https Host")
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		t.Fatal("append CA")
	}
	cfg = cfg.Clone()
	cfg.RootCAs = pool

	if err := httpGetTLS(addr, cfg); err != nil {
		t.Fatalf("non-custom HTTPS path should succeed: %v", err)
	}
}

func httpGetTLS(addr string, tlsCfg *tls.Config) error {
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: tlsCfg,
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				var d net.Dialer
				return d.DialContext(ctx, network, addr)
			},
		},
	}
	req, err := http.NewRequest(http.MethodGet, "https://"+testTLSHostname+"/", nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

func startTLSServer(t *testing.T, serverCert *x509.Certificate, serverKey *ecdsa.PrivateKey) string {
	t.Helper()
	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{{
			Certificate: [][]byte{serverCert.Raw},
			PrivateKey:  serverKey,
			Leaf:        serverCert,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_ = c.(*tls.Conn).Handshake()
				_, _ = io.WriteString(c, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
			}(conn)
		}
	}()
	return ln.Addr().String()
}

func mustTestCerts(t *testing.T) (caPEM []byte, serverCert *x509.Certificate, serverKey *ecdsa.PrivateKey) {
	t.Helper()

	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	caPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})

	serverKey, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	serverTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: testTLSHostname},
		DNSNames:     []string{testTLSHostname},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	serverDER, err := x509.CreateCertificate(rand.Reader, serverTmpl, caCert, &serverKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	serverCert, err = x509.ParseCertificate(serverDER)
	if err != nil {
		t.Fatal(err)
	}
	return caPEM, serverCert, serverKey
}
