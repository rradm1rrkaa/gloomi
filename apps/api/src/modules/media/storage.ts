import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

export type StoredObject = { contentType?: string; size?: number; prefix: Uint8Array };
export interface MediaStorage {
  createUpload(key: string, contentType: string, maxBytes: number): Promise<{ url: string; fields: Record<string, string>; provider?: 'local' | 's3' | 's3-put'; method?: 'PUT' | 'POST' }>;
  inspect(key: string, contentType?: string): Promise<StoredObject>;
  readUrl(key: string, contentType: string): Promise<string>;
  remove(key: string): Promise<void>;
  write?(key: string, source: Readable, contentType: string, sizeBytes: number): Promise<void>;
}

@Injectable()
export class S3MediaStorage implements MediaStorage, OnModuleDestroy {
  private readonly region = process.env.AWS_REGION || 'eu-central-1';
  private readonly endpoint = process.env.S3_ENDPOINT;
  private readonly client = new S3Client({ region: this.endpoint ? (process.env.AWS_REGION || 'auto') : this.region, ...(this.endpoint ? { endpoint: this.endpoint, forcePathStyle: true } : {}) });

  onModuleDestroy() { this.client.destroy(); }

  private bucket() {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new ServiceUnavailableException('Media storage is not configured.');
    return bucket;
  }

  async createUpload(key: string, contentType: string, maxBytes: number) {
    if (this.endpoint) {
      const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket(), Key: key, ContentType: contentType }), { expiresIn: 300 });
      return { url, fields: {}, provider: 's3-put' as const, method: 'PUT' as const };
    }
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket(),
      Key: key,
      Expires: 300,
      Fields: { 'Content-Type': contentType },
      Conditions: [['content-length-range', 1, maxBytes], ['eq', '$Content-Type', contentType], ['eq', '$key', key]],
    });
    return { url, fields };
  }

  async inspect(key: string): Promise<StoredObject> {
    const bucket = this.bucket();
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      if (head.ContentLength === undefined || head.ContentLength > Number.MAX_SAFE_INTEGER) throw new Error('Invalid object length');
      const object = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-31' }));
      const prefix = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
      return { contentType: head.ContentType, size: head.ContentLength, prefix };
    } catch {
      throw new ServiceUnavailableException('Could not verify the uploaded object.');
    }
  }

  async readUrl(key: string, contentType: string) {
    try {
      return await getSignedUrl(this.client, new GetObjectCommand({
        Bucket: this.bucket(), Key: key, ResponseContentType: contentType, ResponseContentDisposition: 'inline',
        ResponseCacheControl: 'private, max-age=60',
      }), { expiresIn: 300 });
    } catch {
      throw new ServiceUnavailableException('Media delivery is temporarily unavailable.');
    }
  }

  async remove(key: string) {
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key })); }
    catch { throw new ServiceUnavailableException('Media cleanup is temporarily unavailable.'); }
  }
}

export function matchesMediaSignature(contentType: string, bytes: Uint8Array) {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  switch (contentType) {
    case 'image/jpeg': return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/png': return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
    case 'image/gif': return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
    case 'image/webp': return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'video/mp4': return bytes.length >= 12 && ascii(4, 4) === 'ftyp';
    case 'video/quicktime': return bytes.length >= 12 && ascii(4, 4) === 'ftyp' && ascii(8, 4).startsWith('qt');
    case 'video/webm': return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    default: return false;
  }
}
