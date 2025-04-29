FROM docker.io/grafana/grafana:11.2.5

COPY info8fcc-greptimedb-datasource-unsigned.zip .
RUN unzip info8fcc-greptimedb-datasource-unsigned.zip -d /var/lib/grafana/plugins/

USER root
RUN rm info8fcc-greptimedb-datasource-unsigned.zip

RUN sed -i 's/^allow_loading_unsigned_plugins =/allow_loading_unsigned_plugins = info8fcc-greptimedb-datasource/' /usr/share/grafana/conf/defaults.ini
