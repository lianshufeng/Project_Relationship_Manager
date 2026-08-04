import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EntityRecord, EntitySchema, GraphLayoutRecord, GraphLayoutSchema,
  GraphSettingsRecord, GraphSettingsSchema, MigrationRunRecord, MigrationRunSchema,
  RelationRecord, RelationSchema, EntityFeedbackRecord, EntityFeedbackSchema,
  FeedbackAttachmentRecord, FeedbackAttachmentSchema,
  PersonActivityRecord, PersonActivitySchema,
} from '../database/schemas.js';
import { EntitiesController, FeedbackController, LayoutsController, PersonActivitiesController, ProjectsController, RelationsController } from './project-data.controller.js';
import { FeedbackService } from './feedback.service.js';
import { ProjectDataService } from './project-data.service.js';

@Module({
  imports: [MongooseModule.forFeature([
    { name: EntityRecord.name, schema: EntitySchema },
    { name: RelationRecord.name, schema: RelationSchema },
    { name: GraphLayoutRecord.name, schema: GraphLayoutSchema },
    { name: GraphSettingsRecord.name, schema: GraphSettingsSchema },
    { name: EntityFeedbackRecord.name, schema: EntityFeedbackSchema },
    { name: FeedbackAttachmentRecord.name, schema: FeedbackAttachmentSchema },
    { name: PersonActivityRecord.name, schema: PersonActivitySchema },
    { name: MigrationRunRecord.name, schema: MigrationRunSchema },
  ])],
  controllers: [ProjectsController, EntitiesController, RelationsController, LayoutsController, FeedbackController, PersonActivitiesController],
  providers: [ProjectDataService, FeedbackService],
  exports: [ProjectDataService],
})
export class ProjectDataModule {}
