FROM docker.io/grafana/grafana:11.2.5

COPY info8fcc-greptimedb-datasource.zip .
RUN unzip info8fcc-greptimedb-datasource.zip -d /var/lib/grafana/plugins/

USER root
RUN rm info8fcc-greptimedb-datasource.zip
