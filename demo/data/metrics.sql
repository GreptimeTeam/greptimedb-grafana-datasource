CREATE TABLE IF NOT EXISTS public.cpu_metrics_30 (
  ts TIMESTAMP(3) NOT NULL,
  host STRING NULL,
  "region" STRING NULL,
  cpu_usage DOUBLE NULL,
  TIME INDEX (ts),
  PRIMARY KEY (host, "region")
);

DELETE FROM public.cpu_metrics_30 WHERE ts >= '2026-01-01T00:00:00Z' AND ts <= '2026-12-31T23:59:59Z';

INSERT INTO public.cpu_metrics_30 (ts, host, "region", cpu_usage) VALUES
('2026-07-21T08:00:00Z', 'host-a', 'us-east', 31.2),
('2026-07-21T08:05:00Z', 'host-a', 'us-east', 45.8),
('2026-07-21T08:10:00Z', 'host-a', 'us-east', 62.3),
('2026-07-21T08:00:00Z', 'host-b', 'us-east', 25.6),
('2026-07-21T08:05:00Z', 'host-b', 'us-east', 35.4),
('2026-07-21T08:10:00Z', 'host-b', 'us-east', 41.9),
('2026-07-21T08:00:00Z', 'host-c', 'eu-west', 58.0),
('2026-07-21T08:05:00Z', 'host-c', 'eu-west', 66.7),
('2026-07-21T08:10:00Z', 'host-c', 'eu-west', 72.4),
('2026-07-21T08:15:00Z', 'host-a', 'us-east', 39.1),
('2026-07-21T08:15:00Z', 'host-b', 'us-east', 44.3),
('2026-07-21T08:15:00Z', 'host-c', 'eu-west', 69.5);
