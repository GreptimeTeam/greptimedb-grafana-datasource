import React, { ChangeEvent, useState } from 'react';
import {
  DataSourcePluginOptionsEditorProps,
  onUpdateDatasourceJsonDataOption,
} from '@grafana/data';
import {  Switch, Input,  Button, Field, HorizontalGroup, Alert, VerticalGroup } from '@grafana/ui';
import { Auth, convertLegacyAuthProps, AuthMethod } from '@grafana/experimental';

import {
  CHConfig,
  CHCustomSetting,
  CHSecureConfig,
  CHLogsConfig,
  CHTracesConfig,
  AliasTableEntry
} from 'types/config';
import { gte as versionGte } from 'semver';
import { ConfigSection, ConfigSubSection } from 'components/experimental/ConfigSection';
import { config } from '@grafana/runtime';
import { Divider } from 'components/Divider';
import { TimeUnit } from 'types/queryBuilder';
import { DefaultDatabaseTableConfig } from 'components/configEditor/DefaultDatabaseTableConfig';
import { LogsConfig } from 'components/configEditor/LogsConfig';
import { TracesConfig } from 'components/configEditor/TracesConfig';
import { QuerySettingsConfig } from 'components/configEditor/QuerySettingsConfig';
import allLabels from 'labels';
import {  useConfigDefaults } from './CHConfigEditorHooks';
import {AliasTableConfig} from "../components/configEditor/AliasTableConfig";

export interface ConfigEditorProps extends DataSourcePluginOptionsEditorProps<CHConfig, CHSecureConfig> {}

export const ConfigEditor: React.FC<ConfigEditorProps> = (props) => {
  const { options, onOptionsChange } = props;
  const { jsonData } = options;
  const labels = allLabels.components.Config.ConfigEditor;

  useConfigDefaults(options, onOptionsChange);
  const onSwitchToggle = (
    key: keyof Pick<CHConfig, 'secure' | 'validateSql' | 'enableSecureSocksProxy' | 'forwardGrafanaHeaders' | 'filterValidationEnabled'>,
    value: boolean
  ) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...options.jsonData,
        [key]: value,
      },
    });
  };


  const onCustomSettingsChange = (customSettings: CHCustomSetting[]) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...options.jsonData,
        customSettings: customSettings.filter((s) => !!s.setting && !!s.value),
      },
    });
  };
  const onLogsConfigChange = (key: keyof CHLogsConfig, value: string | boolean | string[]) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...options.jsonData,
        logs: {
          ...options.jsonData.logs,
          [key]: value
        }
      }
    });
  };
  const onTracesConfigChange = (key: keyof CHTracesConfig, value: string | boolean) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...options.jsonData,
        traces: {
          ...options.jsonData.traces,
          durationUnit: options.jsonData.traces?.durationUnit || TimeUnit.Nanoseconds,
          [key]: value
        }
      }
    });
  };
  const onAliasTableConfigChange = (aliasTables: AliasTableEntry[]) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...options.jsonData,
        aliasTables
      }
    });
  };

  const [customSettings, setCustomSettings] = useState(jsonData.customSettings || []);

  const hasAdditionalSettings = Boolean(
    window.location.hash || // if trying to link to section on page, open all settings (React breaks this?)
    options.jsonData.defaultDatabase ||
    options.jsonData.defaultTable ||
    options.jsonData.dialTimeout ||
    options.jsonData.queryTimeout ||
    options.jsonData.validateSql ||
    options.jsonData.enableSecureSocksProxy ||
    options.jsonData.customSettings ||
    options.jsonData.logs ||
    options.jsonData.traces
  );


  const uidWarning = (!options.uid) && (
    <Alert title="" severity="warning" buttonContent="Close">
      <VerticalGroup>
        <div>
          {'This datasource is missing the'}
          <code>uid</code>
          {'field in its configuration. If your datasource is '}
          <a
            style={{ textDecoration: 'underline' }}
            href='https://grafana.com/docs/grafana/latest/administration/provisioning/#data-sources'
            target='_blank'
            rel='noreferrer'
          >provisioned via YAML</a>
          {', please verify the UID is set. This is required to enable data linking between logs and traces.'}
        </div>
      </VerticalGroup>
    </Alert>
  );


  const newAuthProps = convertLegacyAuthProps({
    config: options,
    onChange: onOptionsChange,
  });

  console.log(newAuthProps)
  function returnSelectedMethod() {

    return newAuthProps.selectedMethod;
  }

  return (
    <>
      {uidWarning}

      <ConfigSection title="Server">
        <Field
          required
          label={labels.serverAddress.label}
          description={labels.serverAddress.tooltip}
          invalid={!jsonData.host}
          error={labels.serverAddress.error}
        >
          <Input
            name="host"
            width={80}
            value={jsonData.host || ''}
            onChange={onUpdateDatasourceJsonDataOption(props, 'host')}
            label={labels.serverAddress.label}
            aria-label={labels.serverAddress.label}
            placeholder={labels.serverAddress.placeholder}
          />
        </Field>

       
      </ConfigSection>


      

      <Divider />
      <Auth
        {...newAuthProps}
        visibleMethods={[AuthMethod.NoAuth, AuthMethod.BasicAuth]}
        onAuthMethodSelect={(method) => {
          onOptionsChange({
            ...options,
            basicAuth: method === AuthMethod.BasicAuth,
            withCredentials: method === AuthMethod.CrossSiteCredentials,
            jsonData: {
              ...options.jsonData,
            },
          });
        }}
        // If your method is selected pass its id to `selectedMethod`,
        // otherwise pass the id from converted legacy data
        selectedMethod={returnSelectedMethod()}
      />
      {/* <ConfigSection title="Credentials">
        <Field
          label={labels.username.label}
          description={labels.username.tooltip}
        >
          <Input
            name="user"
            width={40}
            value={jsonData.username || ''}
            onChange={onUpdateDatasourceJsonDataOption(props, 'username')}
            label={labels.username.label}
            aria-label={labels.username.label}
            placeholder={labels.username.placeholder}
          />
        </Field>
        <Field label={labels.password.label} description={labels.password.tooltip}>
          <SecretInput
            name="pwd"
            width={40}
            label={labels.password.label}
            aria-label={labels.password.label}
            placeholder={labels.password.placeholder}
            value={secureJsonData.password || ''}
            isConfigured={(secureJsonFields && secureJsonFields.password) as boolean}
            onReset={onResetPassword}
            onChange={onUpdateDatasourceSecureJsonDataOption(props, 'password')}
          />
        </Field>
      </ConfigSection> */}

      <Divider />
      <ConfigSection
        title="Additional settings"
        description="Additional settings are optional settings that can be configured for more control over your data source. This includes the default database, dial and query timeouts, SQL validation, and custom GreptimeDB settings."
        isCollapsible
        isInitiallyOpen={hasAdditionalSettings}
      >
        <Divider />
        <DefaultDatabaseTableConfig
          defaultDatabase={jsonData.defaultDatabase}
          defaultTable={jsonData.defaultTable}
          onDefaultDatabaseChange={onUpdateDatasourceJsonDataOption(props, 'defaultDatabase')}
          onDefaultTableChange={onUpdateDatasourceJsonDataOption(props, 'defaultTable')}
        />
        
        <Divider />
        <QuerySettingsConfig
        
          filterValidationEnabled={jsonData.filterValidationEnabled || false}
          
          onFilterValidationEnabledChange={(e) => onSwitchToggle('filterValidationEnabled', e.currentTarget.checked)}
        />

        <Divider />
        <LogsConfig
          logsConfig={jsonData.logs}
          onDefaultDatabaseChange={db => onLogsConfigChange('defaultDatabase', db)}
          onDefaultTableChange={table => onLogsConfigChange('defaultTable', table)}
          onOtelEnabledChange={v => onLogsConfigChange('otelEnabled', v)}
          onOtelVersionChange={v => onLogsConfigChange('otelVersion', v)}
          onTimeColumnChange={c => onLogsConfigChange('timeColumn', c)}
          onLevelColumnChange={c => onLogsConfigChange('levelColumn', c)}
          onMessageColumnChange={c => onLogsConfigChange('messageColumn', c)}
          onSelectContextColumnsChange={c => onLogsConfigChange('selectContextColumns', c)}
          onContextColumnsChange={c => onLogsConfigChange('contextColumns', c)}
        />

        <Divider />
        <TracesConfig
          tracesConfig={jsonData.traces}
          onDefaultDatabaseChange={db => onTracesConfigChange('defaultDatabase', db)}
          onDefaultTableChange={table => onTracesConfigChange('defaultTable', table)}
          onOtelEnabledChange={v => onTracesConfigChange('otelEnabled', v)}
          onOtelVersionChange={v => onTracesConfigChange('otelVersion', v)}
          onTraceIdColumnChange={c => onTracesConfigChange('traceIdColumn', c)}
          onSpanIdColumnChange={c => onTracesConfigChange('spanIdColumn', c)}
          onOperationNameColumnChange={c => onTracesConfigChange('operationNameColumn', c)}
          onParentSpanIdColumnChange={c => onTracesConfigChange('parentSpanIdColumn', c)}
          onServiceNameColumnChange={c => onTracesConfigChange('serviceNameColumn', c)}
          onDurationColumnChange={c => onTracesConfigChange('durationColumn', c)}
          onDurationUnitChange={c => onTracesConfigChange('durationUnit', c)}
          onStartTimeColumnChange={c => onTracesConfigChange('startTimeColumn', c)}
          onTagsColumnChange={c => onTracesConfigChange('tagsColumn', c)}
          onServiceTagsColumnChange={c => onTracesConfigChange('serviceTagsColumn', c)}
          onEventsColumnPrefixChange={c => onTracesConfigChange('eventsColumnPrefix', c)}
        />

        <Divider />
        <AliasTableConfig aliasTables={jsonData.aliasTables} onAliasTablesChange={onAliasTableConfigChange} />
        <Divider />
        {config.secureSocksDSProxyEnabled && versionGte(config.buildInfo.version, '10.0.0') && (
          <Field
            label={labels.secureSocksProxy.label}
            description={labels.secureSocksProxy.tooltip}
          >
            <Switch
              className="gf-form"
              value={jsonData.enableSecureSocksProxy || false}
              onChange={(e) => onSwitchToggle('enableSecureSocksProxy', e.currentTarget.checked)}
            />
          </Field>
        )}
        <ConfigSubSection title="Custom Settings">
          {customSettings.map(({ setting, value }, i) => {
            return (
              <HorizontalGroup key={i}>
                <Field label={`Setting`} aria-label={`Setting`}>
                  <Input
                    value={setting}
                    placeholder={'Setting'}
                    onChange={(changeEvent: ChangeEvent<HTMLInputElement>) => {
                      let newSettings = customSettings.concat();
                      newSettings[i] = { setting: changeEvent.target.value, value };
                      setCustomSettings(newSettings);
                    }}
                    onBlur={() => {
                      onCustomSettingsChange(customSettings);
                    }}
                  ></Input>
                </Field>
                <Field label={'Value'} aria-label={`Value`}>
                  <Input
                    value={value}
                    placeholder={'Value'}
                    onChange={(changeEvent: ChangeEvent<HTMLInputElement>) => {
                      let newSettings = customSettings.concat();
                      newSettings[i] = { setting, value: changeEvent.target.value };
                      setCustomSettings(newSettings);
                    }}
                    onBlur={() => {
                      onCustomSettingsChange(customSettings);
                    }}
                  ></Input>
                </Field>
              </HorizontalGroup>
            );
          })}
          <Button
            variant="secondary"
            icon="plus"
            type="button"
            onClick={() => {
              setCustomSettings([...customSettings, { setting: '', value: '' }]);
            }}
          >
            Add custom setting
          </Button>
        </ConfigSubSection>
      </ConfigSection>
    </>
  );
};
