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

type AdHocVariableFilterOperator = '>' | '<' | '=' | '!=' | '=~' | '!~' | 'IN';

export type AdHocVariableFilter = {
  key: string;
  operator: AdHocVariableFilterOperator;
  value: string;
  condition?: string;
};
