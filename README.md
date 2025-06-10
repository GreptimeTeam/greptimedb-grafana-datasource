# GreptimeDB DataSource for Grafana

![GitHub
Release](https://img.shields.io/github/v/release/greptimeteam/greptimedb-grafana-datasource)
![GitHub
License](https://img.shields.io/github/license/greptimeteam/greptimedb-grafana-datasource)
This is a [Grafana](https://grafana.com/grafana) data source plugin built for
[GreptimeDB](https://github.com/GreptimeTeam/greptimedb). This plugin is built
on top of original Grafana ClickHouse data source and enhanced for GreptimeDB's
additional features.
## Installation

Grab the latest release from [release
page](https://github.com/GreptimeTeam/greptimedb-grafana-datasource/releases/latest/),
Unzip the file to your [grafana plugin
directory](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/#plugins).

### Use grafana cli to download and install

#### Install signed version

```
grafana cli --pluginUrl https://github.com/GreptimeTeam/greptimedb-grafana-datasource/releases/latest/download/info8fcc-greptimedb-datasource.zip plugins install info8fcc
```

#### Install unsigned version

If there is [some error](https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin#why-do-i-get-a-field-is-required-rooturls-error-for-my-private-plugin) when installing signed version, use unsigned version
> you need to set grafana ini file to use unsigned plugin.
>  ```
> allow_loading_unsigned_plugins = info8fcc-greptimedb-datasource
>  ```

If you are using Grafana inside Docker, you need to export the variable:
>  ```
> GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=info8fcc-greptimedb-datasource
>  ```


```
grafana cli --pluginUrl https://github.com/GreptimeTeam/greptimedb-grafana-datasource/releases/latest/download/info8fcc-greptimedb-datasource-unsigned.zip plugins install info8fcc
```

Note that you may need to restart your grafana server after installing the
plugin.

### Docker Image

We also build Grafana docker image that includes GreptimeDB datasource by
default. To run the docker image:

```
docker pull greptime/grafana-greptimedb:latest
docker run -p 3000:3000 greptime/grafana-greptimedb:latest
```

You can log in Grafana by visiting http://localhost:3000. The default username and password are both set to admin.

## Docs

See our setup guide from our [docs](https://docs.greptime.com/user-guide/integrations/grafana).


<!-- 
### Connection
![Connection](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/connection.png)

### Use The Query Builder
* Table: Presents data in a structured table format. Optimized for datasets without a timestamp field.
  ![Table Query](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/table.png)
* Time Series: Provides data that includes a timestamp field, for time series visualization.
  ![Time Series](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/series.png)
* Logs: Supplies data formatted for log analysis.
  ![Logs](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/logs.png)
* Traces: Provides detailed trace data.
  ![Traces](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/traceconfig.png) -->


### Connection settings

Click the Add data source button and select GreptimeDB as the type.

![grafana-add-greptimedb-data-source](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/connection.png)

Fill in the following URL in the GreptimeDB server URL:

```txt
http://<host>:4000
```

In the Auth section, click basic auth, and fill in the username and password for GreptimeDB in the Basic Auth Details section (not set by default, no need to fill in).
- User: `<username>`
- Password: `<password>`

Then click the Save & Test button to test the connection.

### General Query Settings
Before selecting any query type, you first need to configure the **Database** and **Table** to query from.

| Setting   | Description                               |
| :-------- | :---------------------------------------- |
| **Database** | Select the database you want to query.     |
| **Table** | Select the table you want to query from. |


---

### Table Query

Choose the `Table` query type when your query results **do not include a time column**. This is suitable for displaying tabular data.


| Setting   | Description                                     |
| :-------- | :---------------------------------------------- |
| **Columns** | Select the columns you want to retrieve. Multiple selections are allowed. |
| **Filters** | Set conditions to filter your data.             |

![Table Query](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/table.png)

---

### Metrics Query

Select the `Time Series` query type when your query results **include both a time column and a numerical value column**. This is ideal for visualizing metrics over time.

| Main Setting | Description           |
| :----------- | :-------------------- |
| **Time** | Select the time column. |
| **Columns** | Select the numerical value column(s). |

![Time Series](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/series.png)

---

### Logs Query

Choose the `Logs` query type when you want to query log data. You'll need to specify a **Time** column and a **Message** column.

| Main Setting | Description                   |
| :----------- | :---------------------------- |
| **Time** | Select the timestamp column for your logs. |
| **Message** | Select the column containing the log content. |
| **Log Level**| (Optional) Select the column representing the log level. |

![Logs](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/logs.png)

---

### Traces Query

Select the `Traces` query type when you want to query distributed tracing data.

| Main Setting          | Description                                                                                             |
| :-------------------- | :------------------------------------------------------------------------------------------------------ |
| **Trace Model** | Select `Trace Search` to query a list of traces.                                                        |
| **Trace Id Column** | Default value: `trace_id`                                                                               |
| **Span Id Column** | Default value: `span_id`                                                                                |
| **Parent Span ID Column** | Default value: `parent_span_id`                                                                       |
| **Service Name Column** | Default value: `service_name`                                                                         |
| **Operation Name Column** | Default value: `span_name`                                                                            |
| **Start Time Column** | Default value: `timestamp`                                                                              |
| **Duration Time Column** | Default value: `duration_nano`                                                                          |
| **Duration Unit** | Default value: `nano_seconds`                                                                           |
| **Tags Column** | Multiple selections allowed. Corresponds to columns starting with `span_attributes` (e.g., `span_attributes.http.method`). |
| **Service Tags Column** | Multiple selections allowed. Corresponds to columns starting with `resource_attributes` (e.g., `resource_attributes.host.name`). |

![Traces](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/traceconfig.png)

## Development


Yarn 1.x is required for this project. Execute these commands in code root folder

1. Install dependencies

   ```bash
   yarn install
   ```

2. Build plugin in development mode and run in watch mode

   ```bash
   yarn run dev
   ```

3. Build backend plugin binaries for Linux, Windows and Darwin:

   ```bash
   mage -v build:linux
   ```

4. Start Docker Service

   ```bash
   docker compose up
   ```

## License

GreptimeDB uses the [Apache License
2.0](https://apache.org/licenses/LICENSE-2.0.txt) to strike a balance between
open contributions and allowing you to use the software however you want.

