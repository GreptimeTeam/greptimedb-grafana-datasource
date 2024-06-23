# GreptimeDB DataSource for Grafana

![GitHub
Release](https://img.shields.io/github/v/release/greptimeteam/greptimedb-grafana-datasource)
![GitHub
License](https://img.shields.io/github/license/greptimeteam/greptimedb-grafana-datasource)

This is a [Grafana](https://grafana.com/grafana) data source plugin built for
[GreptimeDB](https://github.com/GreptimeTeam/greptimedb). This plugin is built
on top of original Grafana Prometheus data source and enhanced for GreptimeDB's
additional features.

## Screenshots

PromQL query builder with additional field selector.

![explore](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/main/screenshots/1.png)

Time-series data rendered with GreptimeDB data source.

![dashboard](https://raw.githubusercontent.com/GreptimeTeam/greptimedb-grafana-datasource/main/screenshots/2.png)

## Installation

Grab the latest release from [release
page](https://github.com/GreptimeTeam/greptimedb-grafana-datasource/releases/latest/),
Unzip the file to your [grafana plugin
directory](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/#plugins).

You can also use grafana cli to download and install

```
grafana cli --pluginUrl https://github.com/GreptimeTeam/greptimedb-grafana-datasource/releases/latest/download/info8fcc-greptimedb-datasource.zip plugins install info8fcc
```

Note that you may need to restart your grafana server after installing the plugin.

## Quick Start using Docker

You can also try out this plugin from a Grafana docker image:

```
docker run -d -p 3000:3000 --name=grafana --rm \
  -e "GF_INSTALL_PLUGINS=https://github.com/GreptimeTeam/greptimedb-grafana-datasource/releases/latest/download/info8fcc-greptimedb-datasource.zip;info8fcc" \
  grafana/grafana-oss
```

## Docs

See our setup guide from our [docs](https://docs.greptime.com/user-guide/clients/grafana).

## Features and Roadmap

We started this plugin from forking Grafana's built-in Prometheus plugin. The
goal of this plugin is to provide visualization support for all native types
of GreptimeDB data.

- Time series panels
  - [x] PromQL
    - [x] GreptimeDB's additional field selector
  - [ ] SQL
    - [ ] Time macro
- Event UI
  - [ ] Event
- Settings UI
  - [x] DB name input
  - [x] Authentication

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

## Community

Join our [community slack](https://www.greptime.com/slack) channel #grafana for
discussion of this plugin.

## License

GreptimeDB uses the [Apache License
2.0](https://apache.org/licenses/LICENSE-2.0.txt) to strike a balance between
open contributions and allowing you to use the software however you want.
