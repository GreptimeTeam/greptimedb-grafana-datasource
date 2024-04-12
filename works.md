1 plugin-tools 新建一个 backend plugin
2 cp  grafana/public/app/plugins/datasource/prometheus 到新建 plugin 的 src 目录
3 修改依赖错误，很多都依赖 app/core 目录下的文件，还有依赖一些其它插件的文件。如果是文件依赖比较少就把相关依赖 copy 过来, 通过 webpack 别名解决依赖问题。
如果依赖比较多的有的就暂时去掉相关代码了。
4 添加 prometheus docker 数据源，解决容器内数据源访问。修改部分请求 url path，解决 500 问题。  


