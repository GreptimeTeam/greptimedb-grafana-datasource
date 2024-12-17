import { QueryEditorProps } from '@grafana/data';

import { PrometheusDatasource } from '../datasource';
import { PromOptions, PromQuery } from '../types';
import { SqlDatasource } from 'querybuilder/mysql/sql/datasource/SqlDatasource';
import { SQLOptions, SQLQuery } from 'querybuilder/mysql/sql';

export type PromQueryEditorProps = QueryEditorProps<PrometheusDatasource, PromQuery, PromOptions>;

export type SqlQueryEditorProps = QueryEditorProps<SqlDatasource, SQLQuery, SQLOptions>
