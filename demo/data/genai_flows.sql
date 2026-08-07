-- Aggregate/flow tables used by GenAI Observability panels.
-- These approximate Greptime Flow outputs so the old dashboard can run on demo data.

DROP TABLE IF EXISTS public.genai_status_1m;
DROP TABLE IF EXISTS public.genai_token_usage_1m;

CREATE TABLE IF NOT EXISTS public.genai_status_1m (
  time_window TIMESTAMP(3) NOT NULL,
  model STRING NULL,
  span_status STRING NULL,
  request_count BIGINT NULL,
  TIME INDEX (time_window),
  PRIMARY KEY (model, span_status)
);

CREATE TABLE IF NOT EXISTS public.genai_token_usage_1m (
  time_window TIMESTAMP(3) NOT NULL,
  model STRING NULL,
  total_input_tokens BIGINT NULL,
  total_output_tokens BIGINT NULL,
  request_count BIGINT NULL,
  TIME INDEX (time_window),
  PRIMARY KEY (model)
);

INSERT INTO public.genai_status_1m (time_window, model, span_status, request_count) VALUES
('2026-07-21T08:01:00Z', 'gpt-4o-mini', 'STATUS_CODE_UNSET', 2),
('2026-07-21T08:06:00Z', 'gpt-4o', 'STATUS_CODE_ERROR', 1),
('2026-07-21T08:11:00Z', 'gpt-4o-mini', 'STATUS_CODE_UNSET', 1),
('2026-07-21T08:16:00Z', 'gpt-4o-mini', 'STATUS_CODE_UNSET', 1),
('2026-07-21T08:21:00Z', 'gpt-4o', 'STATUS_CODE_UNSET', 1),
('2026-07-21T08:26:00Z', 'gpt-4o', 'STATUS_CODE_ERROR', 1);

INSERT INTO public.genai_token_usage_1m (time_window, model, total_input_tokens, total_output_tokens, request_count) VALUES
('2026-07-21T08:01:00Z', 'gpt-4o-mini', 840, 360, 2),
('2026-07-21T08:06:00Z', 'gpt-4o', 980, 0, 1),
('2026-07-21T08:11:00Z', 'gpt-4o-mini', 310, 95, 1),
('2026-07-21T08:16:00Z', 'gpt-4o-mini', 250, 120, 1),
('2026-07-21T08:21:00Z', 'gpt-4o', 510, 140, 1),
('2026-07-21T08:26:00Z', 'gpt-4o', 800, 0, 1);
