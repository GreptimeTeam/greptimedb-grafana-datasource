import React, { memo, useEffect, useState } from 'react';
import { CoreApp } from '@grafana/data';
import { Icon, RadioButtonGroup, Tooltip, useTheme2 } from '@grafana/ui';
import store from 'app/core/store';

const editorModes = [
  { label: 'PromQL', value: 'promql' },
  { label: 'SQL', value: 'sql' },
];
import { PromQueryEditorSelector } from '../querybuilder/components/PromQueryEditorSelector';

import { PromQueryEditorProps, SqlQueryEditorProps } from '../components/types';
import {SqlQueryEditor} from './mysql/sql/components/QueryEditor';
import { Space } from '@grafana/experimental';


export function PromQueryEditorByApp(props: PromQueryEditorProps | SqlQueryEditorProps) {
  const { app } = props;
  const [mode, setMode] = useState(props.query.sqltype || store.get('sqltype') || 'promql')
  const theme = useTheme2()

  // add default sqltype
  useEffect(() => {
    if (!props.query.sqltype) {
      props.onChange({...props.query, sqltype: mode})
    }
  }, [])

  const onChangeMode = (mode) => {
    setMode(mode)
    store.set('sqltype', mode)
    props.onChange({...props.query, sqltype: mode})
    // props.onChange()
  }
  return <>
    <RadioButtonGroup options={editorModes} size="sm" value={mode} onChange={onChangeMode} />
    <Tooltip content={'GreptimeDB supports both PromQL and SQL for querying'} >
      <Icon name="info-circle" size="sm" style={{marginLeft: '5px'}} />
    </Tooltip>
    {/* <span style={{color: theme.colors.text.secondary}}> </span> */}
    <Space v={0.5} />
    {
      mode === 'sql' ?
        <SqlQueryEditor {...(props) as SqlQueryEditorProps}></SqlQueryEditor>
      :
        <PromQueryEditorSelector {...(props) as PromQueryEditorProps} />
    }
    
  </>


}

export default memo(PromQueryEditorByApp);
