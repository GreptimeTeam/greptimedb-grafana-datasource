## GreptimeDB

GreptimeDB is an open-source time-series database focusing on efficiency, scalability, and analytical capabilities. It's designed to work on infrastructure of the cloud era, and users benefit from its elasticity and commodity storage.   
[Official website](https://greptime.com)    
[Github](https://github.com/GreptimeTeam/greptimedb)


## GreptimeDB Grafana Plugin

The Grafana plugin for GreptimeDB adds multi-value support to the Prometheus plugin.   

Use a multi-value model where a row of data can have multiple metric columns, instead of the single-value model adopted by OpenTSDB and Prometheus. The multi-value model is used to model data sources, where a metric can have multiple values represented by fields. The advantage of the multi-value model is that it can write multiple values to the database at once, while the single-value model requires splitting the data into multiple records.

![node exporter support](https://github.com/GreptimeTeam/grafana-datasource/blob/main/src/img/image.png?raw=true)