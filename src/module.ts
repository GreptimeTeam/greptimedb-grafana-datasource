import { DataSourcePlugin } from '@grafana/data';

import PromCheatSheet from './components/PromCheatSheet';
import PromQueryEditorByApp from './components/PromQueryEditorByApp';
import { ConfigEditor } from './configuration/ConfigEditor';
import  { GreptimeDBDatasource, PrometheusDatasource } from './datasource';

type DatasourceType = typeof PrometheusDatasource
export const plugin = new DataSourcePlugin(GreptimeDBDatasource as unknown as DatasourceType)
  .setQueryEditor(PromQueryEditorByApp)
  .setConfigEditor(ConfigEditor)
  .setQueryEditorHelp(PromCheatSheet);
