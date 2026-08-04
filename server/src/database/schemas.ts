import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument, type Types } from 'mongoose';

export const entityTypes = ['project', 'team', 'position', 'person', 'product', 'deviceType', 'device', 'area'] as const;
export const relationTypes = ['contains', 'belongs_to', 'holds_position', 'uses', 'depends_on', 'binds_to', 'installed_in', 'supports', 'manages', 'covers'] as const;
export const deviceCategories = ['wearable', 'machinery', 'mobile', 'fixed'] as const;
export const activityLevels = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
export const personActivitySourceTypes = ['deviceType', 'product'] as const;
export const feedbackKinds = ['feedback', 'handling'] as const;
export const feedbackStatuses = ['pending', 'resolved'] as const;

export type EntityType = (typeof entityTypes)[number];
export type RelationType = (typeof relationTypes)[number];
export type FeedbackKind = (typeof feedbackKinds)[number];
export type FeedbackStatus = (typeof feedbackStatuses)[number];
export type PersonActivitySourceType = (typeof personActivitySourceTypes)[number];

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
  @Prop({ type: Number, enum: activityLevels }) activityLevel?: number;
  @Prop({ type: Date }) activityUpdatedAt?: Date;
}

export type EntityDocument = HydratedDocument<EntityRecord>;
export const EntitySchema = SchemaFactory.createForClass(EntityRecord);
EntitySchema.index({ projectId: 1, entityType: 1, sort: 1 });
EntitySchema.index({ projectId: 1, parentId: 1 });
EntitySchema.index({ projectId: 1, teamId: 1 });
EntitySchema.index({ projectId: 1, deviceTypeId: 1 });

@Schema({ collection: 'person_activity_records', timestamps: true, strict: 'throw', versionKey: false })
export class PersonActivityRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ type: String, required: true }) projectId: string;
  @Prop({ type: String, required: true }) personId: string;
  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }) activityDate: string;
  @Prop({ type: String, required: true, enum: personActivitySourceTypes }) sourceType: PersonActivitySourceType;
  @Prop({ type: String, required: true }) sourceId: string;
  @Prop({ type: String, required: true, trim: true }) sourceNameSnapshot: string;
  @Prop({ type: Number, required: true, min: 1, max: Number.MAX_SAFE_INTEGER }) activityValue: number;
  @Prop({ type: Number, default: 1, min: 1 }) revision: number;
}

export type PersonActivityDocument = HydratedDocument<PersonActivityRecord>;
export const PersonActivitySchema = SchemaFactory.createForClass(PersonActivityRecord);
PersonActivitySchema.index({ projectId: 1, personId: 1, activityDate: 1, sourceType: 1, sourceId: 1 }, { unique: true });
PersonActivitySchema.index({ projectId: 1, activityDate: 1, personId: 1 });
PersonActivitySchema.index({ projectId: 1, personId: 1, activityDate: -1, sourceType: 1, sourceId: 1 });

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

@Schema({ collection: 'entity_feedbacks', timestamps: true, strict: 'throw', versionKey: false })
export class EntityFeedbackRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ type: String, required: true }) projectId: string;
  @Prop({ type: String, required: true }) entityId: string;
  @Prop({ type: String, required: true, enum: feedbackKinds }) kind: FeedbackKind;
  @Prop({ type: String }) rootFeedbackId?: string;
  @Prop({ type: String, trim: true, maxlength: 5000 }) content?: string;
  @Prop({ type: String, trim: true, maxlength: 50 }) authorName?: string;
  @Prop({ type: String, enum: feedbackStatuses }) status?: FeedbackStatus;
  @Prop({ type: Number, default: 1, min: 1 }) revision: number;
}

export type EntityFeedbackDocument = HydratedDocument<EntityFeedbackRecord>;
export const EntityFeedbackSchema = SchemaFactory.createForClass(EntityFeedbackRecord);
EntityFeedbackSchema.index({ projectId: 1, entityId: 1, kind: 1, createdAt: -1, _id: -1 });
EntityFeedbackSchema.index({ projectId: 1, entityId: 1, rootFeedbackId: 1, createdAt: 1, _id: 1 });

@Schema({ collection: 'feedback_attachments', timestamps: true, strict: 'throw', versionKey: false })
export class FeedbackAttachmentRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ type: String, required: true }) projectId: string;
  @Prop({ type: String, required: true }) entityId: string;
  @Prop({ type: String, required: true }) feedbackId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) gridFsFileId: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: 255 }) fileName: string;
  @Prop({ type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp'] }) mimeType: string;
  @Prop({ type: Number, required: true, min: 1, max: 10485760 }) size: number;
}

export type FeedbackAttachmentDocument = HydratedDocument<FeedbackAttachmentRecord>;
export const FeedbackAttachmentSchema = SchemaFactory.createForClass(FeedbackAttachmentRecord);
FeedbackAttachmentSchema.index({ projectId: 1, entityId: 1, feedbackId: 1, createdAt: 1 });
FeedbackAttachmentSchema.index({ gridFsFileId: 1 }, { unique: true, partialFilterExpression: { gridFsFileId: { $type: 'objectId' } } });

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
