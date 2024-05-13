import React, { RefCallback, useCallback, useEffect, useState } from 'react';
import { Select } from "@grafana/ui";
import { PrometheusDatasource } from "datasource";
import { PromVisualQuery } from "querybuilder/types";
import { EditorField, EditorFieldGroup } from '@grafana/experimental';
import { SelectableValue } from '@grafana/data';

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
  const [fields, setFields] = useState<SelectableValue[]>([])
  const onGetFields = useCallback(async function (): Promise<SelectableValue[]>  {
    // If no metric we need to use a different method
    if (!query.metric) {
      return Promise.resolve([])
    }
    const fields = await datasource.languageProvider.fetchFields(query.metric)
    
    return fields.map((field) => ({label: field, value: field}))
    // let labelsIndex: Record<string, string[]>;
    // if (datasource.hasLabelsMatchAPISupport()) {
    //   labelsIndex = await datasource.languageProvider.fetchSeriesLabelsMatch(expr);
    // } else {
    //   labelsIndex = await datasource.languageProvider.fetchSeriesLabels(expr);
    // }

    // // filter out already used labels
    // return Object.keys(labelsIndex)
    //   .filter((labelName) => !labelsToConsider.find((filter) => filter.label === labelName))
    //   .map((k) => ({ value: k }));
  }, [query, datasource]);
  useEffect(() => {
    onGetFields().then(result => {
      setFields(result)
    })
  }, [onGetFields])

  // useEffect(() => {
  //   console.log('metric change', query.metric)
  // }, [query.metric])

  const [isLoading, setIsLoading] = useState(false)
  let options = [{label: 'grep_id', value: 'grep_id'}, {label: 'grep_id1', value: 'grep_id1'}]
  return (
    <>
      <EditorFieldGroup>
        <EditorField
          label="Field filter (for multi-value modal)"
        >
        <Select
          isClearable={true}
          className="query-segment-field"
          value={query.field}
          options={fields}
          width="auto"
          placeholder="Select field"
          onChange={(change) => {
            if (!change) {
              onChange({...query, field: ''})

            } else if(change.value != null) {
              onChange({...query, field: change.value})
            }
          }}
          isLoading={isLoading}
          onOpenMenu={async () => {
            setIsLoading(true)
            const fields = await onGetFields()
            setFields(fields)
            setIsLoading(false)
          }}
        />
        </EditorField>
      </EditorFieldGroup>
    </>
  )
}
