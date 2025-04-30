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
  ![Traces](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/refs/heads/main/screenshots/screenshots/traceconfig.png)

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

