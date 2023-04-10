declare module "fs-blob-store" {
  import {
    AbstractBlobStore,
    BlobKey,
    CreateCallback,
    ExistsCallback,
    RemoveCallback,
  } from "abstract-blob-store";

  class BlobStore implements AbstractBlobStore {
    constructor(opts: { path: string } | string);

    data: Record<string,unknown>;

    createWriteStream(opts: BlobKey, cb: CreateCallback): NodeJS.WriteStream;
    createReadStream(opts: BlobKey): NodeJS.ReadStream;
    exists(opts: BlobKey, callback: ExistsCallback): void
    remove(opts: BlobKey, callback: RemoveCallback): void
  }

  export default BlobStore;
}
