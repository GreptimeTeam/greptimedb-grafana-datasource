FROM docker.io/grafana/grafana:11.2.5

COPY info8fcc-greptimedb-datasource.zip /
RUN unzip -d info8fcc-greptimedb-datasource.zip /var/lib/grafana/plugins/
RUN rm /info8fcc-greptimedb-datasource.zip
