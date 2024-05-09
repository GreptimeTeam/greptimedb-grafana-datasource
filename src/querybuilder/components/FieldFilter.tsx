import React, { RefCallback, useCallback, useState } from 'react';
import { Select } from "@grafana/ui";
import { PrometheusDatasource } from "datasource";
import { PromVisualQuery } from "querybuilder/types";
import { EditorField, EditorFieldGroup } from '@grafana/experimental';

export interface Props {
  query: PromVisualQuery;
  onChange: (query: PromVisualQuery) => void;
  datasource: PrometheusDatasource;

}

export function FieldFilter ({
  datasource,
  query,
  onChange,
}: Props) {
  let options = [{label: 'grep_id', value: 'grep_id'}, {label: 'grep_id1', value: 'grep_id1'}]
  return (
    <>
      <EditorFieldGroup>
          <EditorField
            label="Field Select"
          >
          <Select
            className="query-segment-field"
            value={query.field}
            options={options}
            width="auto"
            onChange={(change) => {
              if (change.value != null) {
                onChange({...query, field: change.value})
              }
            }}
          />
          </EditorField>
        </EditorFieldGroup>
      
    </>
  )
}
