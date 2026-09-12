/** Where the objects are. The product uses put, get and signed links, and nothing else. */
export interface StoreSettings {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  /** Where credentials are made. The same address as the store unless the store says otherwise. */
  readonly iamEndpoint?: string;
}

export interface StoreCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface StoredObject {
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
}
