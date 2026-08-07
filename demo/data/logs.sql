DROP TABLE IF EXISTS public.genai_conversations;

CREATE TABLE IF NOT EXISTS public.genai_conversations (
  "timestamp" TIMESTAMP(3) NOT NULL,
  body STRING NULL,
  severity_text STRING NULL,
  trace_id STRING NULL,
  span_id STRING NULL,
  scope_name STRING NULL,
  host STRING NULL,
  TIME INDEX ("timestamp"),
  PRIMARY KEY (trace_id, span_id)
);

INSERT INTO public.genai_conversations ("timestamp", body, severity_text, trace_id, span_id, scope_name, host) VALUES
('2026-07-21T08:01:00Z', '{"message":{"role":"user","content":"Summarize todays alerts"}}', 'INFO', 'trace-001', 'span-001-user', 'genai.chat', 'host-a'),
('2026-07-21T08:01:02Z', 'Prompt tokenization done', 'DEBUG', 'trace-001', 'span-001-prep', 'llm.preprocess', 'host-a'),
('2026-07-21T08:01:08Z', '{"message":{"role":"assistant","content":"3 warnings and 1 error in the last hour."}}', 'INFO', 'trace-001', 'span-001-model', 'llm.runtime', 'host-a'),
('2026-07-21T08:01:10Z', 'Persisting response cache entry', 'DEBUG', 'trace-001', 'span-001-cache', 'llm.cache', 'host-a'),
('2026-07-21T08:01:12Z', 'Request completed with status 200', 'INFO', 'trace-001', 'span-001-root-end', 'api.gateway', 'host-a'),
('2026-07-21T08:06:00Z', '{"message":{"role":"user","content":"Explain the timeout on /chat"}}', 'INFO', 'trace-002', 'span-002-user', 'genai.chat', 'host-b'),
('2026-07-21T08:06:05Z', 'Context window too large, fallback triggered', 'WARN', 'trace-002', 'span-002-check', 'llm.guard', 'host-b'),
('2026-07-21T08:06:12Z', 'Request failed: upstream timeout', 'ERROR', 'trace-002', 'span-002-model', 'llm.runtime', 'host-b'),
('2026-07-21T08:06:14Z', 'Retry policy scheduled backoff=200ms', 'WARN', 'trace-002', 'span-002-retry', 'llm.guard', 'host-b'),
('2026-07-21T08:06:17Z', 'Retry attempt exhausted', 'ERROR', 'trace-002', 'span-002-retry-end', 'llm.guard', 'host-b'),
('2026-07-21T08:11:00Z', '{"message":{"role":"user","content":"Stream a short status update"}}', 'INFO', 'trace-003', 'span-003-user', 'genai.chat', 'host-c'),
('2026-07-21T08:11:05Z', 'Streaming response started', 'INFO', 'trace-003', 'span-003-stream', 'llm.runtime', 'host-c'),
('2026-07-21T08:11:07Z', 'Chunk #1 emitted', 'DEBUG', 'trace-003', 'span-003-stream-1', 'llm.runtime', 'host-c'),
('2026-07-21T08:11:09Z', 'Chunk #2 emitted', 'DEBUG', 'trace-003', 'span-003-stream-2', 'llm.runtime', 'host-c'),
('2026-07-21T08:11:12Z', '{"message":{"role":"assistant","content":"All critical services are healthy."}}', 'INFO', 'trace-003', 'span-003-stream-end', 'llm.runtime', 'host-c'),
('2026-07-21T08:16:00Z', '{"message":{"role":"user","content":"What changed in the last deploy?"}}', 'INFO', 'trace-004', 'span-004-user', 'genai.chat', 'host-a'),
('2026-07-21T08:16:01Z', 'Prompt tokenization done', 'DEBUG', 'trace-004', 'span-004-prep', 'llm.preprocess', 'host-a'),
('2026-07-21T08:16:03Z', 'Retriever fetched 4 passages', 'INFO', 'trace-004', 'span-004-rag', 'llm.retriever', 'host-a'),
('2026-07-21T08:16:08Z', '{"message":{"role":"assistant","content":"Latency improved 12% after cache warm-up."}}', 'INFO', 'trace-004', 'span-004-model', 'llm.runtime', 'host-a'),
('2026-07-21T08:16:10Z', 'Request completed with status 200', 'INFO', 'trace-004', 'span-004-root-end', 'api.gateway', 'host-a'),
('2026-07-21T08:21:00Z', '{"message":{"role":"user","content":"Write a customer reply"}}', 'INFO', 'trace-005', 'span-005-user', 'genai.chat', 'host-b'),
('2026-07-21T08:21:02Z', 'Safety check flagged policy hit', 'WARN', 'trace-005', 'span-005-safety', 'llm.guard', 'host-b'),
('2026-07-21T08:21:05Z', '{"message":{"role":"assistant","content":"[redacted] We are investigating and will update soon."}}', 'INFO', 'trace-005', 'span-005-model', 'llm.runtime', 'host-b'),
('2026-07-21T08:21:07Z', 'Request completed with status 200', 'INFO', 'trace-005', 'span-005-root-end', 'api.gateway', 'host-b'),
('2026-07-21T08:26:00Z', '{"message":{"role":"user","content":"Generate a long report"}}', 'INFO', 'trace-006', 'span-006-user', 'genai.chat', 'host-c'),
('2026-07-21T08:26:03Z', 'Prompt tokenization done', 'DEBUG', 'trace-006', 'span-006-prep', 'llm.preprocess', 'host-c'),
('2026-07-21T08:26:08Z', 'Request failed: quota exceeded', 'ERROR', 'trace-006', 'span-006-model', 'llm.runtime', 'host-c'),
('2026-07-21T08:26:10Z', 'Quota check service returned hard limit', 'ERROR', 'trace-006', 'span-006-quota', 'llm.guard', 'host-c'),
('2026-07-21T08:26:13Z', 'Request completed with status 429', 'WARN', 'trace-006', 'span-006-root-end', 'api.gateway', 'host-c');
