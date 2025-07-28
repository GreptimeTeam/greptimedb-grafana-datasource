import { Filter, FilterOperator, ColumnHint } from 'types/queryBuilder';

export interface FilterValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates if there's at least one user-added filter (excluding default time range filters)
 */
export const validateUserFilters = (filters: Filter[]): FilterValidationResult => {
  // Count user-added filters (excluding default time range filters)
  let hasDefaultTimeRangeFilter = false;
  const userFilters = filters.filter(filter => {
    if (!filter.key && !filter.hint) {
      return false;
    }

    // Exclude default time range filters that are automatically added
    const isDefaultTimeRange = filter.hint === ColumnHint.Time
    if (!hasDefaultTimeRangeFilter && isDefaultTimeRange) {
      return false
    }
    hasDefaultTimeRangeFilter = true;
    return true;
  });

  if (userFilters.length === 0) {
    return {
      isValid: false,
      error: 'At least one non-default time range condition is required'
    };
  }

  return { isValid: true };
};

/**
 * Checks if a specific filter is a default time range filter
 */
export const isDefaultTimeRangeFilter = (filter: Filter): boolean => {
  return filter.hint === ColumnHint.Time && 
    filter.operator === FilterOperator.WithInGrafanaTimeRange &&
    filter.id === 'timeRange';
};

/**
 * Gets only user-added filters (excluding default time range filters)
 */
export const getUserFilters = (filters: Filter[]): Filter[] => {
  return filters.filter(filter => !isDefaultTimeRangeFilter(filter));
}; 
