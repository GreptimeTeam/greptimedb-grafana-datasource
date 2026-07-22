import { getTable } from './ast';

/** Grafana ad-hoc filter keys use `table.column`; return the column part for SQL. */
export function columnNameFromAdhocKey(key: string): string {
  const dot = key.lastIndexOf('.');
  return dot >= 0 ? key.slice(dot + 1) : key;
}

/** Parse `table.column` ad-hoc keys returned by getTagKeys(). */
export function tableAndColumnFromAdhocKey(key: string): { table: string; col: string } | undefined {
  const dot = key.lastIndexOf('.');
  if (dot <= 0) {
    return undefined;
  }
  const table = key.slice(0, dot);
  const col = key.slice(dot + 1);
  if (!table || !col || col === 'undefined') {
    return undefined;
  }
  return { table, col };
}

export class AdHocFilter {
  private _targetTable = '';

  setTargetTableFromQuery(query: string) {
    this._targetTable = getTable(query);
    if (this._targetTable === '') {
      throw new Error('Failed to get table from adhoc query.');
    }
  }

  apply(sql: string, adHocFilters: AdHocVariableFilter[]): string {
    if (sql === '' || !adHocFilters || adHocFilters.length === 0) {
      return sql;
    }

    // sql can contain a query with double quotes around the database and table name, e.g. "default"."table", so we remove those
    if (this._targetTable !== '' && !sql.replace(/"/g, '').match(new RegExp(`.*\\b${this._targetTable}\\b.*`, 'gi'))) {
      return sql;
    }

    if (this._targetTable === '') {
      this._targetTable = getTable(sql);
    }

    if (this._targetTable === '') {
      return sql;
    }

    const filters = adHocFilters
      .filter((filter: AdHocVariableFilter) => {
        const valid = isValid(filter);
        if (!valid) {
          console.warn('Invalid adhoc filter will be ignored:', filter);
        }
        return valid;
      })
      .filter((f) => !!columnNameFromAdhocKey(f.key))
      .map((f, i) => {
        const key = columnNameFromAdhocKey(f.key);
        const value = escapeValueBasedOnOperator(f.value, f.operator);
        const condition = i !== adHocFilters.length - 1 ? (f.condition ? f.condition : 'AND') : '';
        const operator = convertAdHocOperator(f.operator);
        return ` ${key} ${operator} ${value} ${condition}`;
      })
      .join('');

    if (filters === '') {
      return sql;
    }
    // Semicolons are not required and cause problems when building the SQL
    sql = sql.replace(';', '');
    return `${sql} settings additional_table_filters={'${this._targetTable}' : '${filters}'}`;
  }
}

function isValid(filter: AdHocVariableFilter): boolean {
  return filter.key !== undefined && filter.operator !== undefined && filter.value !== undefined;
}

function escapeValueBasedOnOperator(s: string, operator: AdHocVariableFilterOperator): string {
  if (operator === 'IN') {
    // Allow list of values without parentheses
    if (s.length > 2 && s[0] !== '(' && s[s.length - 1] !== ')') {
      s = `(${s})`
    }

    return s.replace(/'/g, "\\'");
  } else {
    return `\\'${s}\\'`;
  }
}

function convertAdHocOperator(operator: AdHocVariableFilterOperator): string {
  if (operator === '=~') {
    return 'ILIKE';
  }
  if (operator === '!~') {
    return 'NOT ILIKE';
  }
  return operator;
}

type AdHocVariableFilterOperator = '>' | '<' | '=' | '!=' | '=~' | '!~' | 'IN';

export type AdHocVariableFilter = {
  key: string;
  operator: AdHocVariableFilterOperator;
  value: string;
  condition?: string;
};
