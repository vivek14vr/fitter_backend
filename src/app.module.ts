import 'dotenv/config';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { EnquiriesModule } from './enquiries/enquiries.module.js';
import { TestimonialsModule } from './testimonials/testimonials.module.js';

function mongoUri() {
  const configuredUri = process.env.MONGODB_URI?.trim();
  if (!configuredUri && process.env.NODE_ENV === 'production') {
    throw new Error('MONGODB_URI must be configured in production');
  }
  return configuredUri || 'mongodb://127.0.0.1:27017/deepti_sherawat';
}

@Module({
  imports: [
    MongooseModule.forRoot(mongoUri()),
    AuthModule,
    EnquiriesModule,
    TestimonialsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
