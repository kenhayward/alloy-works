import { ASSET_MAX_BYTES } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { assetRoutes } from './assets.js';
import { buildOpenApi } from './openapi.js';
import { allRoutes } from './routes.js';

const document = buildOpenApi(allRoutes);
const operation = (path: string, method: string) =>
  document.paths[path]?.[method] as {
    requestBody?: { required: boolean; content: Record<string, { schema: unknown }> };
    responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
    parameters?: { name: string; in: string }[];
  };

describe('the asset routes (figures 1)', () => {
  it('makes an upload by create in its space, and fills it by its uploader alone', () => {
    expect(assetRoutes.createAssetUpload).toMatchObject({
      method: 'POST',
      path: '/v1/spaces/{space}/asset-uploads',
      access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    });
    expect(assetRoutes.putAssetUploadBytes).toMatchObject({
      method: 'PUT',
      path: '/v1/asset-uploads/{id}/bytes',
      access: { check: 'session' },
      rawBody: { contentType: 'application/octet-stream', maxBytes: ASSET_MAX_BYTES },
    });
    expect(assetRoutes.getAssetUpload.access).toEqual({ check: 'session' });
  });

  it('reads an asset version, and its bytes, by read on the asset the version belongs to', () => {
    for (const route of [assetRoutes.getAssetVersion, assetRoutes.getAssetVersionContent]) {
      expect(route.access).toEqual({
        check: 'permission',
        permission: 'read',
        target: { artifactVersion: 'id' },
      });
    }
    expect(assetRoutes.getAssetVersionContent.responses[200]).toMatchObject({
      binary: { contentTypes: ['image/png', 'image/jpeg'] },
    });
  });

  it('publishes a raw body as bytes of its one content type, required, and never as JSON', () => {
    const put = operation('/v1/asset-uploads/{id}/bytes', 'put');
    expect(put.requestBody).toEqual({
      required: true,
      content: {
        'application/octet-stream': {
          schema: {
            type: 'string',
            contentMediaType: 'application/octet-stream',
            maxLength: ASSET_MAX_BYTES,
          },
        },
      },
    });
  });

  it('publishes a binary response under each type it may send, with no JSON body', () => {
    const content = operation('/v1/asset-versions/{id}/content', 'get').responses['200']?.content;
    expect(Object.keys(content ?? {})).toEqual(['image/png', 'image/jpeg']);
    expect(content?.['image/png']).toEqual({
      schema: { type: 'string', contentMediaType: 'image/png' },
    });
  });

  it('names an asset version route by the version, as the path its target reads', () => {
    expect(operation('/v1/asset-versions/{id}', 'get').parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path' }),
    ]);
  });
});
