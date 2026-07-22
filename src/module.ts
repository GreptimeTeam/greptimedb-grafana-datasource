import { DataSourcePlugin } from '@grafana/data';
import { Datasource } from './data/GreptimeDatasource';
import { ConfigEditor } from './views/GreptimeConfigEditor';
import { GreptimeQueryEditor } from './views/GreptimeQueryEditor';
import { GreptimeConfig } from 'types/config';
import { GreptimeQuery } from 'types/sql';

export const plugin = new DataSourcePlugin<Datasource, GreptimeQuery, GreptimeConfig>(Datasource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(GreptimeQueryEditor);

// Track dashboard loads to RudderStack
// getAppEvents().subscribe<DashboardLoadedEvent<GreptimeQuery>>(
//   DashboardLoadedEvent,
//   ({ payload: { dashboardId, orgId, grafanaVersion, queries } }) => {
//     const greptimeQueries = queries[pluginJson.id]?.filter((q) => !q.hide);
//     if (!greptimeQueries?.length) {
//       return;
//     }
//   }
// );
