import React from 'react';
import { render, screen } from '@testing-library/react';
import { ConfigEditor } from './CHConfigEditor';
import { mockConfigEditorProps } from '__mocks__/ConfigEditor';
import '@testing-library/jest-dom';
import { Protocol } from 'types/config';
import allLabels from 'labels';

jest.mock('@grafana/runtime', () => {
  const original = jest.requireActual('@grafana/runtime');
  return {
    ...original,
    config: { buildInfo: { version: '10.0.0' }, secureSocksDSProxyEnabled: true },
  };
});

describe('ConfigEditor', () => {
  const labels = allLabels.components.Config.ConfigEditor;

  it('new editor', () => {
    render(<ConfigEditor {...mockConfigEditorProps()} />);
    expect(screen.getByPlaceholderText(labels.serverAddress.placeholder)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(labels.username.placeholder)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(labels.password.placeholder)).toBeInTheDocument();
  });
  it('with password', async () => {
    render(
      <ConfigEditor
        {...mockConfigEditorProps()}
        options={{
          ...mockConfigEditorProps().options,
          secureJsonData: { password: 'foo' },
          secureJsonFields: { password: true },
        }}
      />
    );
    expect(screen.getByPlaceholderText(labels.serverAddress.placeholder)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(labels.username.placeholder)).toBeInTheDocument();
    const a = screen.getByText('Reset');
    expect(a).toBeInTheDocument();
  });
  it('with path', async () => {
    const path = 'custom-path';
    render(
      <ConfigEditor
        {...mockConfigEditorProps()}
        options={{
          ...mockConfigEditorProps().options,
          jsonData: { ...mockConfigEditorProps().options.jsonData, path, protocol: Protocol.Http },
        }}
      />
    );
  });
  it('with secure connection', async () => {
    render(
      <ConfigEditor
        {...mockConfigEditorProps()}
        options={{
          ...mockConfigEditorProps().options,
          jsonData: { ...mockConfigEditorProps().options.jsonData, secure: true },
        }}
      />
    );
  });

});
