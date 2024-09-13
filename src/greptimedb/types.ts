export enum GreptimeDataTypes {
  Null = 'Null',

  // Numeric types:
  Boolean = 'Boolean',
  UInt8 = 'UInt8',
  UInt16 = 'UInt16',
  UInt32 = 'UInt32',
  UInt64 = 'UInt64',
  Int8 = 'Int8',
  Int16 = 'Int16',
  Int32 = 'Int32',
  Int64 = 'Int64',
  Float32 = 'Float32',
  Float64 = 'Float64',

  // String types:
  String = 'String',
  Binary = 'Binary',

  // Date & Time types:

  /**
   * Date representing the elapsed time since UNIX epoch (1970-01-01) in days (32 bits).
   */
  Date = 'Date',
  /**
   * Datetime representing the elapsed time since UNIX epoch (1970-01-01) in
   * seconds/milliseconds/microseconds/nanoseconds, determined by precision.
   */
  DateTime = 'DateTime',

  TimestampSecond = 'TimestampSecond',
  TimestampMillisecond = 'TimestampMillisecond',
  TimestampMicrosecond = 'TimestampMicrosecond',
  TimestampNanosecond = 'TimestampNanosecond',

  List = 'List',
}

// currently unused
export enum GreptimeHttpResultCode {
  // ====== Begin of common status code ==============
  /// Success.
  Success = 0,

  /// Unknown error.
  Unknown = 1000,
  /// Unsupported operation.
  Unsupported = 1001,
  /// Unexpected error, maybe there is a BUG.
  Unexpected = 1002,
  /// Internal server error.
  Internal = 1003,
  /// Invalid arguments.
  InvalidArguments = 1004,
  // ====== End of common status code ================

  // ====== Begin of SQL related status code =========
  /// SQL Syntax error.
  InvalidSyntax = 2000,
  // ====== End of SQL related status code ===========

  // ====== Begin of query related status code =======
  /// Fail to create a plan for the query.
  PlanQuery = 3000,
  /// The query engine fail to execute query.
  EngineExecuteQuery = 3001,
  // ====== End of query related status code =========

  // ====== Begin of catalog related status code =====
  /// Table already exists.
  TableAlreadyExists = 4000,
  TableNotFound = 4001,
  TableColumnNotFound = 4002,
  TableColumnExists = 4003,
  DatabaseNotFound = 4004,
  // ====== End of catalog related status code =======

  // ====== Begin of storage related status code =====
  /// Storage is temporarily unable to handle the request
  StorageUnavailable = 5000,
  // ====== End of storage related status code =======

  // ====== Begin of server related status code =====
  /// Runtime resources exhausted, like creating threads failed.
  RuntimeResourcesExhausted = 6000,
  // ====== End of server related status code =======

  // ====== Begin of auth related status code =====
  /// User not exist
  UserNotFound = 7000,
  /// Unsupported password type
  UnsupportedPasswordType = 7001,
  /// Username and password does not match
  UserPasswordMismatch = 7002,
  /// Not found http authorization header
  AuthHeaderNotFound = 7003,
  /// Invalid http authorization header
  InvalidAuthHeader = 7004,
  /// Illegal request to connect catalog-schema
  AccessDenied = 7005,
  // ====== End of auth related status code =====
}

export enum QueryLanguages {
  Mysql = 'sql',
  PromQL = 'PromQL'
}

interface Output<T extends any[] = any[]> {
  records: {
    schema: {
      column_schemas: GreptimeColumnSchemaBrief[];
    };
    rows: T[];
  };
}

/**
 * T is usually a tuple
 */
export interface GreptimeResponseSuccess<T extends any[] = any[]> {
  code: GreptimeHttpResultCode.Success;
  execution_time_ms: number;
  //this is a single-element array
  output: Array<Output<T>>;
}

export interface GreptimeResponseFailed {
  code: Omit<GreptimeHttpResultCode, GreptimeHttpResultCode.Success>;
  execution_time_ms: number;
  error: string;
}

export type GreptimeResponse<T extends any[] = any[]> =
  | GreptimeResponseSuccess<T>
  | GreptimeResponseFailed;

/**
 * The column schema in the response of the query
 */
export interface GreptimeColumnSchemaBrief {
  name: string;
  data_type: GreptimeDataTypes;
}

/**
 * The data rows from `DESC TABLE`
 */
export interface GreptimeColumnSchemaDetailed {
  name: string;
  data_type: GreptimeDataTypes;
  nullable: boolean;
  default: string;    //TODO maybe this is not a string
  semantic_type: string;
}
