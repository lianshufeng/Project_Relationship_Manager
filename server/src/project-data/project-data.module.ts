import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EntityRecord, EntitySchema, GraphLayoutRecord, GraphLayoutSchema,
  GraphSettingsRecord, GraphSettingsSchema, MigrationRunRecord, MigrationRunSchema,
  RelationRecord, RelationSchema,
} from '../database/schemas.js';
import { EntitiesController, LayoutsController, ProjectsController, RelationsController } from './project-data.controller.js';
import { ProjectDataService } from './project-data.service.js';

@Module({
  imports: [MongooseModule.forFeature([
    { name: EntityRecord.name, schema: EntitySchema },
    { name: RelationRecord.name, schema: RelationSchema },
    { name: GraphLayoutRecord.name, schema: GraphLayoutSchema },
    { name: GraphSettingsRecord.name, schema: GraphSettingsSchema },
    { name: MigrationRunRecord.name, schema: MigrationRunSchema },
  ])],
  controllers: [ProjectsController, EntitiesController, RelationsController, LayoutsController],
  providers: [ProjectDataService],
  exports: [ProjectDataService],
})
export class ProjectDataModule {}
