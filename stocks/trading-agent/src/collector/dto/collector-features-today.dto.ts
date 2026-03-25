import { IsArray, IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class CollectorFeaturesTodayDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symbols?: string[];

  @IsOptional()
  @IsString()
  symbolsCsv?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @IsBoolean()
  includeCandles?: boolean;
}

