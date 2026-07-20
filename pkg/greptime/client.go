package greptime

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// ClientSettings is the subset of datasource settings required for HTTP SQL.
type ClientSettings struct {
	SQLURL                string
	DefaultDatabase       string
	Username              string
	Password              string
	HttpHeaders           map[string]string
	ForwardGrafanaHeaders bool
	QueryTimeout          time.Duration
	TLSConfig             *tls.Config
	Transport             http.RoundTripper
}

// Client executes GreptimeDB HTTP SQL queries.
type Client struct {
	settings ClientSettings
	http     *http.Client
}

func NewClient(settings ClientSettings) *Client {
	transport := settings.Transport
	if transport == nil {
		transport = &http.Transport{
			TLSClientConfig: settings.TLSConfig,
		}
	}

	timeout := settings.QueryTimeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}

	return &Client{
		settings: settings,
		http: &http.Client{
			Timeout:   timeout,
			Transport: transport,
		},
	}
}

func (c *Client) ExecuteSQL(ctx context.Context, sql string, forwarded http.Header) (*Response, error) {
	form := url.Values{}
	form.Set("sql", sql)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.settings.SQLURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	dbName := strings.TrimSpace(c.settings.DefaultDatabase)
	if dbName == "" {
		dbName = "public"
	}
	req.Header.Set("x-greptime-db-name", dbName)

	for k, v := range c.settings.HttpHeaders {
		if strings.TrimSpace(k) != "" {
			req.Header.Set(k, v)
		}
	}

	if c.settings.ForwardGrafanaHeaders && forwarded != nil {
		for k, vals := range forwarded {
			if len(vals) == 0 {
				continue
			}
			req.Header.Set(k, strings.Join(vals, ","))
		}
	}

	if c.settings.Username != "" {
		req.SetBasicAuth(c.settings.Username, c.settings.Password)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, backend.DownstreamError(err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = resp.Status
		}
		return nil, backend.DownstreamError(fmt.Errorf("greptime http %d: %s", resp.StatusCode, msg))
	}

	var parsed Response
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, backend.DownstreamError(fmt.Errorf("decode greptime response: %w", err))
	}

	if parsed.Error != "" {
		return &parsed, backend.DownstreamError(fmt.Errorf("%s", parsed.Error))
	}

	if parsed.Code != 0 {
		if parsed.Error == "" {
			parsed.Error = fmt.Sprintf("greptime error code %d", parsed.Code)
		}
		return &parsed, backend.DownstreamError(fmt.Errorf("%s", parsed.Error))
	}

	return &parsed, nil
}

func (c *Client) Ping(ctx context.Context, forwarded http.Header) error {
	_, err := c.ExecuteSQL(ctx, "SELECT 1", forwarded)
	return err
}

func LogQuery(sql string) {
	const maxLen = 500
	if len(sql) <= maxLen {
		log.DefaultLogger.Debug("greptime sql", "query", sql)
		return
	}
	log.DefaultLogger.Debug("greptime sql", "query", sql[:maxLen]+"...")
}
