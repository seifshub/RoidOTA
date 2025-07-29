import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(private readonly configService: ConfigService) {
    const s3Config = this.configService.get('s3');
    
    this.s3Client = new S3Client({
      endpoint: s3Config.endpoint,
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
      forcePathStyle: true, // Required for MinIO
    });

    this.bucketName = s3Config.bucketName;
  }

  async uploadFirmware(key: string, buffer: Buffer, contentType: string = 'application/octet-stream'): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });

      await this.s3Client.send(command);
      
      // Return the S3 URL
      const s3Url = `${this.configService.get('s3.endpoint')}/${this.bucketName}/${key}`;
      this.logger.log(`Successfully uploaded firmware to S3: ${s3Url}`);
      
      return s3Url;
    } catch (error) {
      this.logger.error(`Failed to upload firmware to S3: ${error.message}`, error);
      throw error;
    }
  }

  async deleteFirmware(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`Successfully deleted firmware from S3: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete firmware from S3: ${error.message}`, error);
      throw error;
    }
  }

  async getSignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      return signedUrl;
    } catch (error) {
      this.logger.error(`Failed to generate signed URL for ${key}: ${error.message}`, error);
      throw error;
    }
  }

  generateFirmwareKey(firmwareName: string, version: string): string {
    const timestamp = Date.now();
    return `firmware/${firmwareName}_v${version}_${timestamp}.bin`;
  }
}
