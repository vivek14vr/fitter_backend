import { IsMongoId, IsString } from 'class-validator';

export class AssignNutritionistDto {
  @IsString()
  @IsMongoId()
  nutritionistId: string;
}
