import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const entityTypes = ['project', 'team', 'position', 'person', 'product', 'deviceType', 'device', 'area'] as const;
export const relationTypes = ['contains', 'belongs_to', 'holds_position', 'uses', 'depends_on', 'binds_to', 'installed_in', 'supports', 'manages', 'covers'] as const;
export const deviceCategories = ['wearable', 'machinery', 'mobile', 'fixed'] as const;

export type EntityType = (typeof entityTypes)[number];
export type RelationType = (typeof relationTypes)[number];

@Schema({ collection: 'entities', timestamps: true, strict: 'throw', versionKey: false })
export class EntityRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ type: String, required: true, index: true }) projectId: string;
  @Prop({ type: String, required: true, enum: entityTypes, index: true }) entityType: EntityType;
  @Prop({ type: String, required: true, trim: true }) name: string;
  @Prop({ type: String }) icon?: string;
  @Prop({ type: String }) color?: string;
  @Prop({ type: String }) description?: string;
  @Prop({ type: Number, default: 99 }) sort: number;
  @Prop({ type: Number, default: 1, min: 1 }) revision: number;

  @Prop({ type: String }) shortName?: string;
  @Prop({ type: String }) address?: string;
  @Prop({ type: String }) parentId?: string;
  @Prop({ type: String }) teamType?: string;
  @Prop({ type: String }) teamId?: string;
  @Prop({ type: String }) phone?: string;
  @Prop({ type: String }) avatar?: string;
  @Prop({ type: String, enum: deviceCategories }) category?: string;
  @Prop({ type: String }) deviceTypeId?: string;
  @Prop({ type: String }) code?: string;
}

export type EntityDocument = HydratedDocument<EntityRecord>;
export const EntitySchema = SchemaFactory.createForClass(EntityRecord);
EntitySchema.index({ projectId: 1, entityType: 1, sort: 1 });
EntitySchema.index({ projectId: 1, parentId: 1 });
EntitySchema.index({ projectId: 1, teamId: 1 });
EntitySchema.index({ projectId: 1, deviceTypeId: 1 });

@Schema({ collection: 'relations', timestamps: true, strict: 'throw', versionKey: false })
export class RelationRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ type: String, required: true, index: true }) projectId: string;
  @Prop({ type: String, required: true, index: true }) sourceEntityId: string;
  @Prop({ type: String, required: true, index: true }) targetEntityId: string;
  @Prop({ type: String, required: true, enum: relationTypes, index: true }) relationType: RelationType;
  @Prop({ type: String }) label?: string;
  @Prop({ type: Number, default: 0 }) sort: number;
  @Prop({ type: Number, default: 1, min: 1 }) revision: number;
}

export type RelationDocument = HydratedDocument<RelationRecord>;
export const RelationSchema = SchemaFactory.createForClass(RelationRecord);
RelationSchema.index({ projectId: 1, sourceEntityId: 1, targetEntityId: 1, relationType: 1 }, { unique: true });

@Schema({ collection: 'graph_layouts', timestamps: true, strict: 'throw', versionKey: false })
export class GraphLayoutRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ type: String, required: true, index: true }) projectId: string;
  @Prop({ type: String, required: true }) entityId: string;
  @Prop({ type: Number, required: true }) x: number;
  @Prop({ type: Number, required: true }) y: number;
}

export type GraphLayoutDocument = HydratedDocument<GraphLayoutRecord>;
export const GraphLayoutSchema = SchemaFactory.createForClass(GraphLayoutRecord);
GraphLayoutSchema.index({ projectId: 1, entityId: 1 }, { unique: true });

@Schema({ collection: 'graph_settings', timestamps: true, strict: 'throw', versionKey: false })
export class GraphSettingsRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ type: String, required: true, unique: true }) projectId: string;
  @Prop({ type: String, required: true, enum: ['LR', 'TB'], default: 'LR' }) layoutDirection: 'LR' | 'TB';
  @Prop({ type: Number }) zoom?: number;
  @Prop({ type: Number }) viewportX?: number;
  @Prop({ type: Number }) viewportY?: number;
}

export type GraphSettingsDocument = HydratedDocument<GraphSettingsRecord>;
export const GraphSettingsSchema = SchemaFactory.createForClass(GraphSettingsRecord);

@Schema({ collection: 'migration_runs', timestamps: true, strict: 'throw', versionKey: false })
export class MigrationRunRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ type: String, required: true }) sourceHash: string;
  @Prop({ type: Number, required: true }) entityCount: number;
  @Prop({ type: Number, required: true }) relationCount: number;
  @Prop({ type: Number, required: true }) layoutCount: number;
  @Prop({ type: String, required: true, enum: ['completed'] }) status: 'completed';
}

export type MigrationRunDocument = HydratedDocument<MigrationRunRecord>;
export const MigrationRunSchema = SchemaFactory.createForClass(MigrationRunRecord);
