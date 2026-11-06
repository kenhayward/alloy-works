import type { SinkDescribe } from '@kenhayward/bridge-contract';

/**
 * What `/bridge` says of itself (docs/design/ct-studio-sink.md, "The contract as served"): contract
 * version 2 and one shared connection holding a service identity's token. No instance is listed, as
 * for any shared sink: the hostname names the tenant, and CT Studio's targets and browsing name none.
 */
export function describeSink(environment: string): SinkDescribe {
  return {
    // The environment by name, so CT Studio's lists tell two Alloy Works sinks apart.
    name: `Alloy Works (${environment})`,
    contractVersion: 2,
    connectionKind: 'shared',
    instances: [],
    credentialFields: [{ id: 'token', label: 'Service identity token', secret: true }],
    destinationFields: [
      {
        id: 'space',
        label: 'Space',
        kind: 'fixed',
        required: true,
        overridable: false,
        browse: true,
      },
      {
        id: 'documentName',
        label: 'Document name',
        kind: 'pattern',
        required: false,
        overridable: true,
        browse: false,
      },
      {
        id: 'tableSet',
        label: 'Table set',
        kind: 'pattern',
        required: false,
        overridable: false,
        browse: false,
      },
    ],
    capabilities: {
      browse: true,
      replace: true,
      withdraw: false,
      readBack: true,
      accepts: ['files', 'data', 'document', 'images'],
      decomposedDocuments: { equations: ['mathml', 'image'] },
    },
  };
}
