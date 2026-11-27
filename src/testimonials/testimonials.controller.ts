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
import {
  DEFAULT_PUBLIC_TESTIMONIAL_LIMIT,
  MAX_PUBLIC_TESTIMONIAL_LIMIT,
  TestimonialsService,
} from './testimonials.service.js';
import {
  TESTIMONIAL_CATEGORIES,
  TESTIMONIAL_PLACEMENTS,
  type TestimonialCategory,
  type TestimonialPlacement,
} from './schemas/testimonial.schema.js';

function parsePlacements(value: unknown): TestimonialPlacement[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  if (!values.every((entry): entry is string => typeof entry === 'string')) {
    throw new BadRequestException('Unsupported testimonial placement');
  }
  const requested = values
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const placements = [...new Set(requested)];
  if (!placements.length) return ['testimonials'];
  if (placements.some((placement) => !(TESTIMONIAL_PLACEMENTS as readonly string[]).includes(placement))) {
    throw new BadRequestException('Unsupported testimonial placement');
  }
  return placements as TestimonialPlacement[];
}

function parseLimit(value: unknown) {
  if (value !== undefined && typeof value !== 'string') {
    throw new BadRequestException('Provide one testimonial limit');
  }
  if (!value?.trim()) return DEFAULT_PUBLIC_TESTIMONIAL_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new BadRequestException('Testimonial limit must be a positive integer');
  }
  return Math.min(limit, MAX_PUBLIC_TESTIMONIAL_LIMIT);
}

function parseCategory(value: unknown): TestimonialCategory | 'general' | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new BadRequestException('Provide one testimonial category');
  }
  const category = value?.trim().toLowerCase();
  if (!category) return undefined;
  if (category === 'general') return category;
  if ((TESTIMONIAL_CATEGORIES as readonly string[]).includes(category)) return category as TestimonialCategory;
  throw new BadRequestException('Unsupported testimonial category');
}

function parseOffset(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new BadRequestException('Testimonial offset must be a non-negative integer');
  }
  return Number(value);
}

@Controller('testimonials')
export class TestimonialsController {
  constructor(private readonly testimonialsService: TestimonialsService) {}

  @Get()
  list(
    @Query('placement') placementValue?: unknown,
    @Query('category') categoryValue?: unknown,
    @Query('limit') limitValue?: unknown,
    @Query('offset') offsetValue?: unknown,
  ) {
    return this.testimonialsService.listPublic(
      parsePlacements(placementValue),
      parseCategory(categoryValue),
      parseLimit(limitValue),
      parseOffset(offsetValue),
    );
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

  @Delete(':id/permanent')
  async remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const testimonial = await this.testimonialsService.remove(id);
    await this.recordAudit(request, 'testimonial.deleted', 'testimonial', testimonial.id);
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
