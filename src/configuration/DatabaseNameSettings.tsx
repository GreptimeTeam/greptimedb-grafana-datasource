import {Field, Input, SecretInput, Label } from '@grafana/ui';
import React, { useEffect, useState, } from 'react';
import { ConfigSection } from '@grafana/experimental';
export default function DatabaseNameSettings ({config, onChange}) {
  const [name, setName] = useState(config.jsonData.httpHeaderValue1)
  function onInputChange (e) {
    const value = e.target.value
    setName(value)
    const { jsonData, secureJsonData } = config
    const newJsonData = Object.assign({}, jsonData)
    newJsonData.httpHeaderName1 = 'x-greptime-db-name'
    const newSecureJsonData = Object.assign({}, secureJsonData)
    newSecureJsonData.httpHeaderValue1 = value
    onChange(
      {
        ...config,
        jsonData: newJsonData,
        secureJsonData: newSecureJsonData,
      }
    )
  }

  function onReset () {
    setName('')
    const { secureJsonFields } = config
    const newSecureJsonFields = Object.assign({}, secureJsonFields)
    newSecureJsonFields.httpHeaderValue1 = false
    onChange({
      ...config,
      secureJsonFields: newSecureJsonFields
    })
  }

  return (
    <ConfigSection title="Database Name">
      <Field >
        <SecretInput width={30} value={name} onChange={onInputChange} isConfigured={config.secureJsonFields.httpHeaderValue1} onReset={onReset} />
      </Field>
    </ConfigSection>
  )
}
