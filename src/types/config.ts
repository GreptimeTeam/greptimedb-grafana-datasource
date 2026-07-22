import { DataSourceJsonData, KeyValue } from '@grafana/data';

export interface GreptimeConfig extends DataSourceJsonData {
  /**
   * The version of the plugin this config was saved with
   */
  version: string;

  host: string;
  port: number;
  protocol: Protocol;
  secure?: boolean;
  path?: string;

  tlsSkipVerify?: boolean;
  tlsAuth?: boolean;
  tlsAuthWithCACert?: boolean;

  username: string;

  defaultDatabase?: string;
  defaultTable?: string;

  connMaxLifetime?: string;
  dialTimeout?: string;
  maxIdleConns?: string;
  maxOpenConns?: string;
  queryTimeout?: string;
  validateSql?: boolean;

  /**
   * Enable filter validation to require at least one user-added filter
   */
  filterValidationEnabled?: boolean;

  logs?: GreptimeLogsConfig;
  traces?: GreptimeTracesConfig;

  aliasTables?: AliasTableEntry[];

  httpHeaders?: GreptimeHttpHeader[];
  forwardGrafanaHeaders?: boolean;

  customSettings?: GreptimeCustomSetting[];
  enableSecureSocksProxy?: boolean;
}

interface GreptimeSecureConfigProperties {
  password?: string;

  tlsCACert?: string;
  tlsClientCert?: string;
  tlsClientKey?: string;
}
export type GreptimeSecureConfig = GreptimeSecureConfigProperties | KeyValue<string>;

export interface GreptimeHttpHeader {
  name: string;
  value: string;
  secure: boolean;
}

export interface GreptimeCustomSetting {
  setting: string;
  value: string;
}

export interface GreptimeLogsConfig {
  defaultDatabase?: string;
  defaultTable?: string;

  otelEnabled?: boolean;
  otelVersion?: string;

  timeColumn?: string;
  levelColumn?: string;
  messageColumn?: string;
  traceIdColumn?: string;

  selectContextColumns?: boolean;
  contextColumns?: string[];
}

export interface GreptimeTracesConfig {
  defaultDatabase?: string;
  defaultTable?: string;

  otelEnabled?: boolean;
  otelVersion?: string;

  traceIdColumn?: string;
  spanIdColumn?: string;
  operationNameColumn?: string;
  parentSpanIdColumn?: string;
  serviceNameColumn?: string;
  durationColumn?: string;
  durationUnit?: string;
  startTimeColumn?: string;
  tagsColumn?: string;
  serviceTagsColumn?: string;
  eventsColumnPrefix?: string;
}

export interface AliasTableEntry {
  targetDatabase: string;
  targetTable: string;
  aliasDatabase: string;
  aliasTable: string;
}

export enum Protocol {
  Native = 'native',
  Http = 'http',
}
