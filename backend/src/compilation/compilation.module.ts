import { Module } from '@nestjs/common';
import { CompilationService } from './compilation.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [CompilationService],
  exports: [CompilationService],
})
export class CompilationModule {}