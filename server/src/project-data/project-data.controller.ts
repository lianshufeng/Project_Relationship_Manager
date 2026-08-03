import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { EntityType } from '../database/schemas.js';
import {
  CreateProjectDto, EntityMutationDto, RelationMutationDto, ReorderRelationsDto,
  UpdateGraphSettingsDto, UpdateLayoutDto, UpdateLayoutsDto,
} from './dto.js';
import { ProjectDataService } from './project-data.service.js';

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
  export(@Param('projectId') projectId: string) { return this.service.getGraph(projectId); }
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
