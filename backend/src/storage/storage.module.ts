import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [S3Module],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
