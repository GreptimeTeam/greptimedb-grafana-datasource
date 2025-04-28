import { DataSourcePlugin, DashboardLoadedEvent } from '@grafana/data';
import { Datasource } from './data/CHDatasource';
import { ConfigEditor } from './views/CHConfigEditor';
import { CHQueryEditor } from './views/CHQueryEditor';
import { CHConfig } from 'types/config';
import { CHQuery } from 'types/sql';
import { getAppEvents } from '@grafana/runtime';
import pluginJson from './plugin.json';

export const plugin = new DataSourcePlugin<Datasource, CHQuery, CHConfig>(Datasource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(CHQueryEditor);

// Track dashboard loads to RudderStack
getAppEvents().subscribe<DashboardLoadedEvent<CHQuery>>(
  DashboardLoadedEvent,
  ({ payload: { dashboardId, orgId, grafanaVersion, queries } }) => {
    const clickhouseQueries = queries[pluginJson.id]?.filter((q) => !q.hide);
    if (!clickhouseQueries?.length) {
      return;
    }
  }
);
