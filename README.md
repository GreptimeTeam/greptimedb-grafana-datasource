
# GreptimeDB DataSource


## Install packaged plugin Locally(you can use either)

1. ### use docker compose (Recommend, contains dependency docker image)
  * down load [compose file](https://github.com/GreptimeTeam/greptimedb-grafana-datasource/tree/main/docker)
  * run `docker compose up`

2. ### unzip directly 
unzip the [plugin zip](https://github.com/GreptimeTeam/greptimedb-grafana-datasource/archive/refs/tags/v1.0.2.zip) to your [grafana plugin directory](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/#plugins).

3. ### use grafana cli
```
grafana cli --pluginUrl https://github.com/GreptimeTeam/greptimedb-grafana-datasource/releases/download/v1.0.2/info8fcc-greptimedb-datasource.zip plugins install info8fcc
```

4. ### use docker
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

1. `yarn build`
2. `mage`
3. `yarn sign`
4. `yarn zip`

>  export GRAFANA_ACCESS_POLICY_TOKEN before execute yarn sign


