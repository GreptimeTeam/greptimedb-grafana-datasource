
# GreptimeDB DataSource


## Install packaged plugin Locally(Use of either method)

> we haven't publish this plugin to grafana, you can install local currentlly.

> get plugin zip from  [release page](https://github.com/GreptimeTeam/greptimedb-grafana-datasource/releases) 

1. ### Use docker compose (Recommend, contains dependency docker image)
  * download [files in docker dirctory](https://github.com/GreptimeTeam/greptimedb-grafana-datasource/tree/main/docker)
  * `cd` your downloaded diretory, run `docker compose up` 

2. ### Unzip directly 
unzip the [plugin zip](https://github.com/GreptimeTeam/greptimedb-grafana-datasource/archive/refs/tags/v1.0.2.zip) to your [grafana plugin directory](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/#plugins).

3. ### Use grafana cli
```
grafana cli --pluginUrl https://github.com/GreptimeTeam/greptimedb-grafana-datasource/releases/download/v1.0.2/info8fcc-greptimedb-datasource.zip plugins install info8fcc
```

4. ### Use docker
```
docker run -d -p 3000:3000 --name=grafana \
  -e "GF_INSTALL_PLUGINS=https://github.com/GreptimeTeam/greptimedb-grafana-datasource/releases/download/v1.0.2/info8fcc-greptimedb-datasource.zip;info8fcc" \
  grafana/grafana-oss
```

> after install, restart your grafana server

## Local startup dev mode

***use yarn 1.x (There's a little problem with npm)***

Execute theses commands in code root folder

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


## Build Plugin

trigger release action by push tags


