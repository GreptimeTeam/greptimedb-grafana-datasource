import { useState, useEffect } from 'react';
import { Datasource } from 'data/GreptimeDatasource';

export default (datasource: Datasource): readonly string[] => {
  const [databases, setDatabases] = useState<string[]>([]); 

  useEffect(() => {
    if (!datasource) {
      return;
    }

    datasource.
      fetchDatabases().
      then(databases => setDatabases(databases)).
      catch((ex: any) => {
        console.error('Failed to fetch databases', ex);
      });
    }, [datasource]);
    
    return databases;
}
