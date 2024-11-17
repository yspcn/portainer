import { v4 as uuid } from 'uuid';
import { useReducer, useState } from 'react';

import { Environment } from '@/react/portainer/environments/types';
import { EdgeScriptForm } from '@/react/edge/components/EdgeScriptForm';
import { CommandTab } from '@/react/edge/components/EdgeScriptForm/scripts';
import { OS, EdgeInfo } from '@/react/edge/components/EdgeScriptForm/types';
import { EdgeKeyDisplay } from '@/react/portainer/environments/ItemView/EdgeKeyDisplay';

import { Button } from '@@/buttons';

import { EdgeAgentForm } from './EdgeAgentForm';

interface Props {
  onCreate: (environment: Environment) => void;
  commands: CommandTab[] | Partial<Record<OS, CommandTab[]>>;
  asyncMode?: boolean;
}

export function EdgeAgentTab({ onCreate, commands, asyncMode = false }: Props) {
  const [edgeInfo, setEdgeInfo] = useState<EdgeInfo>();
  const [formKey, clearForm] = useReducer((state) => state + 1, 0);

  return (
    <>
      <EdgeAgentForm
        onCreate={handleCreate}
        readonly={!!edgeInfo}
        key={formKey}
        asyncMode={asyncMode}
      />

      {edgeInfo && (
        <>
          <div className="clear-both" />

          <hr />

          <EdgeKeyDisplay edgeKey={edgeInfo.key} />

          <hr />

          <EdgeScriptForm
            edgeInfo={edgeInfo}
            commands={commands}
            asyncMode={asyncMode}
          />

          <hr />

          <div className="row">
            <div className="flex justify-end">
              <Button color="primary" type="reset" onClick={handleReset}>
                添加另一个环境
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );

  function handleCreate(environment: Environment) {
    setEdgeInfo({ key: environment.EdgeKey, id: environment.EdgeID || uuid() });
    onCreate(environment);
  }

  function handleReset() {
    setEdgeInfo(undefined);
    clearForm();
  }
}