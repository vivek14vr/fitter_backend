import { BadRequestException } from '@nestjs/common';

export type Pagination = {
  page: number;
  limit: number;
  skip: number;
};

export function parsePagination(pageValue?: string, limitValue?: string): Pagination {
  const page = pageValue === undefined ? 1 : Number(pageValue);
  const limit = limitValue === undefined ? 50 : Number(limitValue);

  if (!Number.isInteger(page) || page < 1) {
    throw new BadRequestException('page must be a positive integer');
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new BadRequestException('limit must be an integer between 1 and 100');
  }

  return { page, limit, skip: (page - 1) * limit };
}

export function paginationMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
