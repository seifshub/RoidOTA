import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config/configuration';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  /** Signs URLs against the endpoint devices can actually reach. */
  private readonly presignClient: S3Client;
  private readonly bucketName: string;

  constructor(config: ConfigService) {
    const s3 = config.getOrThrow<AppConfig['s3']>('s3');
    const base = {
      region: s3.region,
      credentials: {
        accessKeyId: s3.accessKeyId!,
        secretAccessKey: s3.secretAccessKey!,
      },
      forcePathStyle: s3.forcePathStyle, // path-style URLs, required by self-hosted S3 servers
    };

    this.client = new S3Client({ ...base, endpoint: s3.endpoint });
    this.presignClient =
      s3.publicEndpoint && s3.publicEndpoint !== s3.endpoint
        ? new S3Client({ ...base, endpoint: s3.publicEndpoint })
        : this.client;
    this.bucketName = s3.bucketName;
  }

  /** Creates the bucket on first start so a fresh stack works out of the box. */
  async onModuleInit() {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.bucketName }),
      );
    } catch (headError) {
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucketName }),
        );
        this.logger.log(`Created bucket ${this.bucketName}`);
      } catch (createError) {
        this.logger.warn(
          `Bucket ${this.bucketName} is not reachable (${errorMessage(headError)}) ` +
            `and could not be created (${errorMessage(createError)})`,
        );
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.bucketName }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async upload(
    key: string,
    body: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    this.logger.log(`Uploaded ${key} (${body.length} bytes)`);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
    );
    this.logger.log(`Deleted ${key}`);
  }

  getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      { expiresIn },
    );
  }
}
