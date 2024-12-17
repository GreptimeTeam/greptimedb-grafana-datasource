import { SQLOptions, SQLQuery } from './sql/types';

export interface MySQLOptions extends SQLOptions {
  allowCleartextPasswords?: boolean;
}

export interface MySQLQuery extends SQLQuery {}
