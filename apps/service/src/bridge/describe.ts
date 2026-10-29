import type { SinkDescribe } from '@kenhayward/bridge-contract';

/**
 * What `/bridge` says of itself (docs/design/ct-studio-sink.md, "The contract as served"): contract
 * version 2, one shared connection holding a service identity's token, and one instance, the tenant
 * the hostname resolves to, by its slug and its name.
 */
export function describeSink(instance: {
  readonly id: string;
  readonly label: string;
}): SinkDescribe {
  return {
    name: 'Alloy Works',
    contractVersion: 2,
    connectionKind: 'shared',
    instances: [{ id: instance.id, label: instance.label }],
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
