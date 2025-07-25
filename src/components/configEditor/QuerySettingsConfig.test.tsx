import React from 'react';
import { render } from '@testing-library/react';
import { QuerySettingsConfig } from './QuerySettingsConfig';

describe('QuerySettingsConfig', () => {
  it('should render', () => {
    const result = render(
      <QuerySettingsConfig
        filterValidationEnabled={true}
        onFilterValidationEnabledChange={() => {}}
      />
    );
    expect(result.container.firstChild).not.toBeNull();
  });

});
