import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { AuditLog, type AuditLogDocument } from '../auth/schemas/audit-log.schema.js';
import { UserRole } from '../auth/user-role.enum.js';
import { CreateTestimonialDto } from './dto/create-testimonial.dto.js';
import { CreateTestimonialUploadDto } from './dto/create-testimonial-upload.dto.js';
import { DeleteTestimonialUploadDto } from './dto/delete-testimonial-upload.dto.js';
import { UpdateTestimonialDto } from './dto/update-testimonial.dto.js';
import { TestimonialStorageService } from './testimonial-storage.service.js';
import { TestimonialsService } from './testimonials.service.js';
import type { TestimonialPlacement } from './schemas/testimonial.schema.js';

function parsePlacement(value?: string): TestimonialPlacement {
  const placement = value?.trim().toLowerCase() || 'testimonials';
  if (placement === 'homepage' || placement === 'testimonials') return placement;
  throw new BadRequestException('Unsupported testimonial placement');
}

@Controller('testimonials')
export class TestimonialsController {
  constructor(private readonly testimonialsService: TestimonialsService) {}

  @Get()
  list(@Query('placement') placementValue?: string) {
    return this.testimonialsService.listPublic(parsePlacement(placementValue));
  }
}

@Controller('admin/testimonials')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminTestimonialsController {
  constructor(
    private readonly testimonialsService: TestimonialsService,
    private readonly storageService: TestimonialStorageService,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  @Get()
  list() {
    return this.testimonialsService.listAdmin();
  }

  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  async createUploadUrl(@Body() dto: CreateTestimonialUploadDto, @Req() request: AuthenticatedRequest) {
    const upload = await this.storageService.createUpload(dto);
    await this.recordAudit(request, 'testimonial.upload_url_created', 'storage', upload.objectKey);
    return upload;
  }

  @Delete('upload')
  async discardUpload(@Body() dto: DeleteTestimonialUploadDto, @Req() request: AuthenticatedRequest) {
    const result = await this.testimonialsService.discardUpload(dto.objectKey);
    await this.recordAudit(request, 'testimonial.upload_discarded', 'storage', dto.objectKey.trim());
    return result;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTestimonialDto, @Req() request: AuthenticatedRequest) {
    const testimonial = await this.testimonialsService.create(dto);
    await this.recordAudit(request, 'testimonial.created', 'testimonial', testimonial.id);
    return { testimonial };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTestimonialDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const testimonial = await this.testimonialsService.update(id, dto);
    await this.recordAudit(request, 'testimonial.updated', 'testimonial', testimonial.id);
    return { testimonial };
  }

  @Delete(':id')
  async archive(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const testimonial = await this.testimonialsService.archive(id);
    await this.recordAudit(request, 'testimonial.archived', 'testimonial', testimonial.id);
    return { testimonial };
  }

  private async recordAudit(
    request: AuthenticatedRequest,
    action: string,
    targetType: string,
    targetId: string,
  ) {
    await this.auditLogModel.create({
      actorId: request.user.sub,
      actorRole: request.user.role,
      action,
      targetType,
      targetId,
    });
  }
}
