import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { EntityType } from '../database/schemas.js';
import {
  CreateFeedbackDto, CreateProjectDto, EntityMutationDto, RelationMutationDto, ReorderRelationsDto, UpdateFeedbackDto,
  UpdateGraphSettingsDto, UpdateLayoutDto, UpdateLayoutsDto,
} from './dto.js';
import { ProjectDataService } from './project-data.service.js';
import { FeedbackService, type FeedbackImage } from './feedback.service.js';

@ApiTags('项目')
@Controller({ path: 'projects', version: '1' })
export class ProjectsController {
  constructor(private readonly service: ProjectDataService) {}

  @Get() list() { return this.service.listProjects(); }
  @Post() create(@Body() dto: CreateProjectDto) { return this.service.createProject(dto); }
  @Delete(':projectId') delete(@Param('projectId') projectId: string) { return this.service.deleteProject(projectId); }
  @Get(':projectId/graph') graph(@Param('projectId') projectId: string) { return this.service.getGraph(projectId); }
  @Get(':projectId/export')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="project-relationship-data.json"')
  export(@Param('projectId') projectId: string) { return this.service.exportProject(projectId); }
  @Post(':projectId/import') import(@Param('projectId') projectId: string, @Body() data: Record<string, unknown>) { return this.service.importGraph(projectId, data); }
  @Patch(':projectId/settings') settings(@Param('projectId') projectId: string, @Body() dto: UpdateGraphSettingsDto) { return this.service.updateGraphSettings(projectId, dto); }
}

@ApiTags('实体')
@Controller({ path: 'projects/:projectId/entities', version: '1' })
export class EntitiesController {
  constructor(private readonly service: ProjectDataService) {}

  @Get() list(@Param('projectId') projectId: string, @Query('type') type?: EntityType) { return this.service.listEntities(projectId, type); }
  @Get(':entityId') get(@Param('projectId') projectId: string, @Param('entityId') entityId: string) { return this.service.getEntity(projectId, entityId); }
  @Post() create(@Param('projectId') projectId: string, @Body() dto: EntityMutationDto) { return this.service.createEntity(projectId, dto); }
  @Patch(':entityId') update(@Param('projectId') projectId: string, @Param('entityId') entityId: string, @Body() dto: EntityMutationDto) { return this.service.updateEntity(projectId, entityId, dto); }
  @Delete(':entityId') delete(@Param('projectId') projectId: string, @Param('entityId') entityId: string) { return this.service.deleteEntity(projectId, entityId); }
}

@ApiTags('关系')
@Controller({ path: 'projects/:projectId/relations', version: '1' })
export class RelationsController {
  constructor(private readonly service: ProjectDataService) {}

  @Get() list(@Param('projectId') projectId: string) { return this.service.listRelations(projectId); }
  @Post() create(@Param('projectId') projectId: string, @Body() dto: RelationMutationDto) { return this.service.createRelation(projectId, dto); }
  @Patch('order') order(@Param('projectId') projectId: string, @Body() dto: ReorderRelationsDto) { return this.service.reorderRelations(projectId, dto.relationIds, dto.startSort); }
  @Patch(':relationId') update(@Param('projectId') projectId: string, @Param('relationId') relationId: string, @Body() dto: RelationMutationDto) { return this.service.updateRelation(projectId, relationId, dto); }
  @Delete(':relationId') delete(@Param('projectId') projectId: string, @Param('relationId') relationId: string) { return this.service.deleteRelation(projectId, relationId); }
}

@ApiTags('布局')
@Controller({ path: 'projects/:projectId/layouts', version: '1' })
export class LayoutsController {
  constructor(private readonly service: ProjectDataService) {}

  @Patch() updateMany(@Param('projectId') projectId: string, @Body() dto: UpdateLayoutsDto) { return this.service.updateLayouts(projectId, dto.positions); }
  @Patch(':entityId') update(@Param('projectId') projectId: string, @Param('entityId') entityId: string, @Body() dto: UpdateLayoutDto) { return this.service.updateLayout(projectId, entityId, dto); }
}

const feedbackUpload = FileFieldsInterceptor([{ name: 'images', maxCount: 20 }], {
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
});

@ApiTags('实体反馈')
@Controller({ path: 'projects/:projectId/entities/:entityId/feedbacks', version: '1' })
export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Get()
  list(@Param('projectId') projectId: string, @Param('entityId') entityId: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.list(projectId, entityId, Number(page || 1), Number(pageSize || 5));
  }

  @Post()
  @UseInterceptors(feedbackUpload)
  create(@Param('projectId') projectId: string, @Param('entityId') entityId: string, @Body() dto: CreateFeedbackDto, @UploadedFiles() files?: { images?: FeedbackImage[] }) {
    return this.service.create(projectId, entityId, dto, files?.images || []);
  }

  @Post(':feedbackId/handling-records')
  @UseInterceptors(feedbackUpload)
  createHandling(@Param('projectId') projectId: string, @Param('entityId') entityId: string, @Param('feedbackId') feedbackId: string, @Body() dto: CreateFeedbackDto, @UploadedFiles() files?: { images?: FeedbackImage[] }) {
    return this.service.createHandling(projectId, entityId, feedbackId, dto, files?.images || []);
  }

  @Patch(':recordId')
  @UseInterceptors(feedbackUpload)
  update(@Param('projectId') projectId: string, @Param('entityId') entityId: string, @Param('recordId') recordId: string, @Body() dto: UpdateFeedbackDto, @UploadedFiles() files?: { images?: FeedbackImage[] }) {
    return this.service.update(projectId, entityId, recordId, dto, files?.images || []);
  }

  @Delete(':recordId')
  delete(@Param('projectId') projectId: string, @Param('entityId') entityId: string, @Param('recordId') recordId: string) {
    return this.service.delete(projectId, entityId, recordId);
  }

  @Get('attachments/:attachmentId')
  async attachment(@Param('projectId') projectId: string, @Param('entityId') entityId: string, @Param('attachmentId') attachmentId: string, @Res() response: Response) {
    const attachment = await this.service.getAttachment(projectId, entityId, attachmentId);
    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    response.setHeader('Content-Length', attachment.size);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    attachment.stream.on('error', () => response.destroy());
    attachment.stream.pipe(response);
  }
}
