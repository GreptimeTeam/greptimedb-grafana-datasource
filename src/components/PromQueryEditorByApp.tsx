import React, { memo } from 'react';

import { CoreApp } from '@grafana/data';

import { PromQueryEditorSelector } from '../querybuilder/components/PromQueryEditorSelector';

import { PromQueryEditorForAlerting } from './PromQueryEditorForAlerting';
import { PromQueryEditorProps, SqlQueryEditorProps } from './types';
import QueryWrapper from '../querybuilder/QueryWrapper';
import { QueryEditorProperty } from 'querybuilder/mysql/sql/expressions';


export function PromQueryEditorByApp(props: PromQueryEditorProps) {
  const { app } = props;

  switch (app) {
    case CoreApp.CloudAlerting:
      return <PromQueryEditorForAlerting {...props} />;
    default:
      return <QueryWrapper {...(props as PromQueryEditorProps & SqlQueryEditorProps)} />;
  }
}

export default memo(PromQueryEditorByApp);
