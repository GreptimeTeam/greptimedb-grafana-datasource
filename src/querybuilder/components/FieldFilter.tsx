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
  const onGetFields = async (): Promise<SelectableValue[]> => {
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
  };
  useEffect(() => {
    onGetFields().then(result => {
      setFields(result)
    })
  }, [])

  const [isLoading, setIsLoading] = useState(false)
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
          options={fields}
          width="auto"
          placeholder="Select Field"
          onChange={(change) => {
            if (change.value != null) {
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
