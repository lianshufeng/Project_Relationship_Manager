import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { deviceCategories, entityTypes, relationTypes, type EntityType, type RelationType } from '../database/schemas.js';

export class CreateProjectDto {
  @IsOptional() @IsString() id?: string;
  @IsString() name: string;
  @IsOptional() @IsString() shortName?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() icon?: string;
}

export class EntityMutationDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsIn(entityTypes) entityType?: EntityType;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsString() shortName?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() avatar?: string;
  @IsOptional() @IsIn(deviceCategories) category?: string;
  @IsOptional() @IsString() deviceTypeId?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) positionIds?: string[];
  @IsOptional() @IsString() areaId?: string;
  @IsOptional() @IsString() parentProductId?: string;
}

export class RelationMutationDto {
  @IsOptional() @IsString() id?: string;
  @IsString() sourceId: string;
  @IsString() targetId: string;
  @IsIn(relationTypes) relationType: RelationType;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsInt() sort?: number;
}

export class LayoutPositionDto {
  @IsString() entityId: string;
  @IsNumber() x: number;
  @IsNumber() y: number;
}

export class UpdateLayoutDto {
  @IsNumber() x: number;
  @IsNumber() y: number;
}

export class UpdateLayoutsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => LayoutPositionDto)
  positions: LayoutPositionDto[];
}

export class UpdateGraphSettingsDto {
  @IsOptional() @IsIn(['LR', 'TB']) layoutDirection?: 'LR' | 'TB';
  @IsOptional() @IsNumber() zoom?: number;
  @IsOptional() @IsNumber() viewportX?: number;
  @IsOptional() @IsNumber() viewportY?: number;
}

export class ReorderRelationsDto {
  @IsArray() @IsString({ each: true }) relationIds: string[];
  @IsOptional() @IsInt() @Min(0) startSort?: number;
}
