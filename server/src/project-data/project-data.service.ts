import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { ClientSession, Connection, Model } from 'mongoose';
import {
  EntityRecord, GraphLayoutRecord, GraphSettingsRecord, RelationRecord,
  type EntityType, type RelationType,
} from '../database/schemas.js';
import type {
  CreateProjectDto, EntityMutationDto, LayoutPositionDto, RelationMutationDto,
  UpdateGraphSettingsDto,
} from './dto.js';

type PlainEntity = EntityRecord & { createdAt?: Date; updatedAt?: Date };
type PlainRelation = RelationRecord & { createdAt?: Date; updatedAt?: Date };

const labels: Record<RelationType, string> = {
  contains: '包含', belongs_to: '属于', holds_position: '担任', uses: '使用', depends_on: '依赖',
  binds_to: '绑定', installed_in: '安装于', supports: '支撑功能', manages: '管理', covers: '覆盖',
};

@Injectable()
export class ProjectDataService {
  constructor(
    @InjectModel(EntityRecord.name) private readonly entities: Model<EntityRecord>,
    @InjectModel(RelationRecord.name) private readonly relations: Model<RelationRecord>,
    @InjectModel(GraphLayoutRecord.name) private readonly layouts: Model<GraphLayoutRecord>,
    @InjectModel(GraphSettingsRecord.name) private readonly settings: Model<GraphSettingsRecord>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async listProjects() {
    const projects = await this.entities.find({ entityType: 'project' }).sort({ name: 1 }).lean().exec();
    return projects.map(project => this.toEntity(project as PlainEntity));
  }

  async createProject(dto: CreateProjectDto) {
    const projectId = dto.id || `project-${randomUUID()}`;
    try {
      await this.connection.transaction(async session => {
        await this.entities.create([{
          _id: projectId, projectId, entityType: 'project', name: dto.name,
          shortName: dto.shortName, address: dto.address, description: dto.description,
          icon: dto.icon || 'BankOutlined', sort: 0, revision: 1,
        }], { session });
        await this.settings.create([{ _id: projectId, projectId, layoutDirection: 'LR' }], { session });
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictException('项目 ID 已存在');
      throw error;
    }
    return this.getEntity(projectId, projectId);
  }

  async deleteProject(projectId: string) {
    await this.ensureProject(projectId);
    const deleted = { entityCount: 0, relationCount: 0, layoutCount: 0, settingsCount: 0 };
    await this.connection.transaction(async session => {
      deleted.relationCount = (await this.relations.deleteMany({ projectId }).session(session)).deletedCount;
      deleted.layoutCount = (await this.layouts.deleteMany({ projectId }).session(session)).deletedCount;
      deleted.settingsCount = (await this.settings.deleteMany({ projectId }).session(session)).deletedCount;
      deleted.entityCount = (await this.entities.deleteMany({ projectId }).session(session)).deletedCount;
    });
    return { message: '当前项目数据已清空', ...deleted };
  }

  async getGraph(projectId: string) {
    const [entityRows, relationRows, layoutRows, graphSettings] = await Promise.all([
      this.entities.find({ projectId }).sort({ entityType: 1, sort: 1 }).lean().exec(),
      this.relations.find({ projectId }).sort({ sort: 1, _id: 1 }).lean().exec(),
      this.layouts.find({ projectId }).lean().exec(),
      this.settings.findOne({ projectId }).lean().exec(),
    ]);
    const entities = entityRows as PlainEntity[];
    const relations = relationRows as PlainRelation[];
    const project = entities.find(entity => entity.entityType === 'project' && entity._id === projectId);
    if (!project) throw new NotFoundException('项目不存在');

    const index = new Map(entities.map(entity => [entity._id, entity]));
    const holdsByPerson = new Map<string, string[]>();
    const areaByDevice = new Map<string, string>();
    for (const relation of relations) {
      if (relation.relationType === 'holds_position') {
        holdsByPerson.set(relation.sourceEntityId, [...(holdsByPerson.get(relation.sourceEntityId) || []), relation.targetEntityId]);
      }
      if (relation.relationType === 'installed_in') areaByDevice.set(relation.sourceEntityId, relation.targetEntityId);
    }

    const byType = <T>(type: EntityType, map: (entity: PlainEntity) => T) => entities.filter(entity => entity.entityType === type).map(map);
    return {
      schemaVersion: '1.0',
      dataRevision: 16,
      project: {
        id: project._id, name: project.name, shortName: project.shortName, address: project.address,
        description: project.description, icon: project.icon || 'BankOutlined',
      },
      teams: byType('team', entity => ({
        id: entity._id, projectId, parentId: entity.parentId, name: entity.name, type: entity.teamType || '',
        icon: entity.icon || 'TeamOutlined', color: entity.color, sort: entity.sort, description: entity.description,
      })),
      positions: byType('position', entity => ({
        id: entity._id, projectId, teamId: entity.teamId, name: entity.name,
        icon: entity.icon || 'IdcardOutlined', color: entity.color, sort: entity.sort, description: entity.description,
      })),
      persons: byType('person', entity => ({
        id: entity._id, name: entity.name, phone: entity.phone, avatar: entity.avatar,
        icon: entity.icon || 'UserOutlined', positionIds: holdsByPerson.get(entity._id) || [], description: entity.description,
      })),
      products: byType('product', entity => ({
        id: entity._id, name: entity.name, icon: entity.icon || 'AppstoreOutlined',
        color: entity.color, description: entity.description,
      })),
      deviceTypes: byType('deviceType', entity => ({
        id: entity._id, name: entity.name, category: entity.category || '', icon: entity.icon || 'ToolOutlined',
        color: entity.color, description: entity.description,
      })),
      devices: byType('device', entity => ({
        id: entity._id, deviceTypeId: entity.deviceTypeId || '', areaId: areaByDevice.get(entity._id),
        name: entity.name, code: entity.code, description: entity.description,
      })),
      areas: byType('area', entity => ({
        id: entity._id, projectId, name: entity.name, icon: entity.icon || 'EnvironmentOutlined', description: entity.description,
      })),
      relations: relations.map(relation => ({
        id: relation._id,
        sourceType: index.get(relation.sourceEntityId)?.entityType,
        sourceId: relation.sourceEntityId,
        targetType: index.get(relation.targetEntityId)?.entityType,
        targetId: relation.targetEntityId,
        relationType: relation.relationType,
        label: relation.label,
      })),
      settings: {
        layoutDirection: graphSettings?.layoutDirection || 'LR',
        positions: Object.fromEntries(layoutRows.map(layout => [layout.entityId, { x: layout.x, y: layout.y }])),
        zoom: graphSettings?.zoom,
        viewportX: graphSettings?.viewportX,
        viewportY: graphSettings?.viewportY,
      },
    };
  }

  async importGraph(projectId: string, value: Record<string, unknown>) {
    const project = value.project as Record<string, unknown> | undefined;
    const collections = ['teams', 'positions', 'persons', 'products', 'deviceTypes', 'devices', 'areas', 'relations'] as const;
    if (value.schemaVersion !== '1.0' || value.dataRevision !== 16 || !project || project.id !== projectId || typeof project.name !== 'string' || !project.name.trim() || collections.some(key => !Array.isArray(value[key]))) {
      throw new BadRequestException('导入配置结构无效或项目 ID 不匹配');
    }
    const rows = <T extends Record<string, unknown>>(key: typeof collections[number]) => value[key] as T[];
    const entities: Array<Record<string, unknown> & { _id: string }> = [
      { _id: projectId, projectId, entityType: 'project', name: project.name, shortName: project.shortName, address: project.address, description: project.description, icon: project.icon || 'BankOutlined', sort: 0, revision: 1 },
      ...rows('teams').map(item => ({ _id: String(item.id), projectId, entityType: 'team', name: item.name, parentId: item.parentId, teamType: item.type, icon: item.icon, color: item.color, sort: item.sort ?? 99, description: item.description, revision: 1 })),
      ...rows('positions').map(item => ({ _id: String(item.id), projectId, entityType: 'position', name: item.name, teamId: item.teamId, icon: item.icon, color: item.color, sort: item.sort ?? 99, description: item.description, revision: 1 })),
      ...rows('persons').map(item => ({ _id: String(item.id), projectId, entityType: 'person', name: item.name, phone: item.phone, avatar: item.avatar, icon: item.icon, description: item.description, sort: 99, revision: 1 })),
      ...rows('products').map(item => ({ _id: String(item.id), projectId, entityType: 'product', name: item.name, icon: item.icon, color: item.color, description: item.description, sort: 99, revision: 1 })),
      ...rows('deviceTypes').map(item => ({ _id: String(item.id), projectId, entityType: 'deviceType', name: item.name, category: item.category, icon: item.icon, color: item.color, description: item.description, sort: 99, revision: 1 })),
      ...rows('devices').map(item => ({ _id: String(item.id), projectId, entityType: 'device', name: item.name, deviceTypeId: item.deviceTypeId, code: item.code, description: item.description, sort: 99, revision: 1 })),
      ...rows('areas').map(item => ({ _id: String(item.id), projectId, entityType: 'area', name: item.name, icon: item.icon, description: item.description, sort: 99, revision: 1 })),
    ];
    const relations = rows('relations').map((item, sort) => ({
      _id: String(item.id), projectId, sourceEntityId: String(item.sourceId), targetEntityId: String(item.targetId),
      relationType: item.relationType, label: item.label, sort, revision: 1,
    }));
    const settings = (value.settings || {}) as { layoutDirection?: 'LR' | 'TB'; positions?: Record<string, { x: number; y: number }>; zoom?: number; viewportX?: number; viewportY?: number };
    const layouts = Object.entries(settings.positions || {}).map(([entityId, position]) => ({
      _id: `${projectId}:${entityId}`, projectId, entityId, x: position.x, y: position.y,
    }));
    const ids = new Set(entities.map(entity => entity._id));
    if (ids.size !== entities.length) throw new BadRequestException('导入配置包含重复实体 ID');
    if (relations.some(relation => !ids.has(relation.sourceEntityId) || !ids.has(relation.targetEntityId))) {
      throw new BadRequestException('导入配置包含孤立关系');
    }

    await this.connection.transaction(async session => {
      await this.relations.deleteMany({ projectId }).session(session);
      await this.layouts.deleteMany({ projectId }).session(session);
      await this.settings.deleteMany({ projectId }).session(session);
      await this.entities.deleteMany({ projectId }).session(session);
      await this.entities.insertMany(entities, { session });
      await this.relations.insertMany(relations, { session });
      if (layouts.length) await this.layouts.insertMany(layouts, { session });
      await this.settings.create([{
        _id: projectId, projectId, layoutDirection: settings.layoutDirection || 'LR',
        zoom: settings.zoom, viewportX: settings.viewportX, viewportY: settings.viewportY,
      }], { session });
    });
    return { message: '项目配置已导入', entityCount: entities.length, relationCount: relations.length, layoutCount: layouts.length };
  }

  async listEntities(projectId: string, entityType?: EntityType) {
    await this.ensureProject(projectId);
    const rows = await this.entities.find({ projectId, ...(entityType ? { entityType } : {}) }).sort({ entityType: 1, sort: 1 }).lean().exec();
    return (rows as PlainEntity[]).map(entity => this.toEntity(entity));
  }

  async getEntity(projectId: string, entityId: string) {
    const entity = await this.entities.findOne({ _id: entityId, projectId }).lean().exec() as PlainEntity | null;
    if (!entity) throw new NotFoundException('实体不存在');
    return this.toEntity(entity);
  }

  async createEntity(projectId: string, dto: EntityMutationDto) {
    await this.ensureProject(projectId);
    if (!dto.entityType || dto.entityType === 'project') throw new BadRequestException('请选择有效的实体类型');
    if (!dto.name?.trim()) throw new BadRequestException('实体名称不能为空');
    const entityId = dto.id || `${dto.entityType}-${randomUUID()}`;

    await this.connection.transaction(async session => {
      const record = this.buildEntity(projectId, entityId, dto.entityType!, dto);
      await this.validateEntityStructure(projectId, record as PlainEntity, session);
      await this.entities.create([record], { session });
      await this.syncManagedRelations(projectId, record as PlainEntity, dto, session);
    });
    return this.getEntity(projectId, entityId);
  }

  async updateEntity(projectId: string, entityId: string, dto: EntityMutationDto) {
    let result: PlainEntity | null = null;
    await this.connection.transaction(async session => {
      const current = await this.entities.findOne({ _id: entityId, projectId }).session(session).lean().exec() as PlainEntity | null;
      if (!current) throw new NotFoundException('实体不存在');
      if (dto.entityType && dto.entityType !== current.entityType) throw new BadRequestException('实体类型不可修改');
      const patch = this.buildEntityPatch(current.entityType, dto);
      await this.validateEntityStructure(projectId, { ...current, ...patch }, session);
      result = await this.entities.findOneAndUpdate(
        { _id: entityId, projectId }, { $set: patch, $inc: { revision: 1 } },
        { new: true, runValidators: true, session, lean: true },
      ).exec() as PlainEntity | null;
      await this.syncManagedRelations(projectId, { ...current, ...patch }, dto, session);
    });
    return this.toEntity(result!);
  }

  async deleteEntity(projectId: string, entityId: string) {
    await this.connection.transaction(async session => {
      const entity = await this.entities.findOne({ _id: entityId, projectId }).session(session).lean().exec() as PlainEntity | null;
      if (!entity) throw new NotFoundException('实体不存在');
      if (entity.entityType === 'project') throw new BadRequestException('项目根实体不能通过实体接口删除');
      if (entity.entityType === 'position' && await this.relations.exists({ projectId, targetEntityId: entityId, relationType: 'holds_position' }).session(session)) {
        throw new ConflictException('岗位下仍有任职人员，请先调整人员岗位');
      }
      if (entity.entityType === 'deviceType' && await this.entities.exists({ projectId, entityType: 'device', deviceTypeId: entityId }).session(session)) {
        throw new ConflictException('设备类型仍被设备使用');
      }
      if (entity.entityType === 'team' && await this.entities.exists({ projectId, $or: [{ parentId: entityId }, { teamId: entityId }] }).session(session)) {
        throw new ConflictException('团队下仍有子团队或岗位');
      }
      if (entity.entityType === 'area' && await this.relations.exists({ projectId, targetEntityId: entityId, relationType: 'installed_in' }).session(session)) {
        throw new ConflictException('区域内仍有固定设备');
      }
      await this.entities.deleteOne({ _id: entityId, projectId }).session(session);
      await this.relations.deleteMany({ projectId, $or: [{ sourceEntityId: entityId }, { targetEntityId: entityId }] }).session(session);
      await this.layouts.deleteOne({ projectId, entityId }).session(session);
    });
    return { message: '实体及关联数据已删除' };
  }

  async listRelations(projectId: string) {
    await this.ensureProject(projectId);
    const rows = await this.relations.find({ projectId }).sort({ sort: 1 }).lean().exec();
    return (rows as PlainRelation[]).map(relation => this.toRelation(relation));
  }

  async createRelation(projectId: string, dto: RelationMutationDto) {
    await this.ensureProject(projectId);
    const relationId = dto.id || `relation-${randomUUID()}`;
    await this.validateRelation(projectId, dto.sourceId, dto.targetId, dto.relationType);
    try {
      await this.relations.create({
        _id: relationId, projectId, sourceEntityId: dto.sourceId, targetEntityId: dto.targetId,
        relationType: dto.relationType, label: dto.label || labels[dto.relationType], sort: dto.sort || 0, revision: 1,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictException('关系已存在');
      throw error;
    }
    return this.getRelation(projectId, relationId);
  }

  async updateRelation(projectId: string, relationId: string, dto: RelationMutationDto) {
    await this.validateRelation(projectId, dto.sourceId, dto.targetId, dto.relationType);
    const relation = await this.relations.findOneAndUpdate(
      { _id: relationId, projectId },
      { $set: { sourceEntityId: dto.sourceId, targetEntityId: dto.targetId, relationType: dto.relationType, label: dto.label || labels[dto.relationType], sort: dto.sort || 0 }, $inc: { revision: 1 } },
      { new: true, runValidators: true, lean: true },
    ).exec() as PlainRelation | null;
    if (!relation) throw new NotFoundException('关系不存在');
    return this.toRelation(relation);
  }

  async deleteRelation(projectId: string, relationId: string) {
    const relation = await this.relations.findOne({ _id: relationId, projectId }).lean().exec() as PlainRelation | null;
    if (!relation) throw new NotFoundException('关系不存在');
    if (relation.relationType === 'holds_position') {
      const count = await this.relations.countDocuments({ projectId, sourceEntityId: relation.sourceEntityId, relationType: 'holds_position' });
      if (count <= 1) throw new ConflictException('人员必须至少保留一个岗位');
    }
    if (relation.relationType === 'installed_in') throw new ConflictException('请通过编辑固定设备调整安装区域');
    if ((relation.relationType === 'contains' && relation.sourceEntityId === projectId) || relation.relationType === 'covers') {
      throw new ConflictException('项目结构关系不能单独删除');
    }
    await this.relations.deleteOne({ _id: relationId, projectId });
    return { message: '关系已删除' };
  }

  async reorderRelations(projectId: string, relationIds: string[], startSort = 0) {
    const existing = await this.relations.countDocuments({ projectId, _id: { $in: relationIds } });
    if (existing !== new Set(relationIds).size) throw new BadRequestException('包含无效或重复的关系 ID');
    await this.relations.bulkWrite(relationIds.map((id, index) => ({
      updateOne: { filter: { _id: id, projectId }, update: { $set: { sort: startSort + index }, $inc: { revision: 1 } } },
    })));
    return { message: '关系顺序已更新' };
  }

  async updateLayout(projectId: string, entityId: string, position: Omit<LayoutPositionDto, 'entityId'>) {
    await this.ensureEntity(projectId, entityId);
    await this.layouts.updateOne(
      { projectId, entityId },
      { $set: { x: position.x, y: position.y }, $setOnInsert: { _id: `${projectId}:${entityId}` } },
      { upsert: true, runValidators: true },
    );
    return { entityId, ...position };
  }

  async updateLayouts(projectId: string, positions: LayoutPositionDto[]) {
    const ids = positions.map(position => position.entityId);
    const count = await this.entities.countDocuments({ projectId, _id: { $in: ids } });
    if (count !== new Set(ids).size) throw new BadRequestException('布局包含无效或重复的实体 ID');
    if (positions.length) await this.layouts.bulkWrite(positions.map(position => ({
      updateOne: {
        filter: { projectId, entityId: position.entityId },
        update: { $set: { x: position.x, y: position.y }, $setOnInsert: { _id: `${projectId}:${position.entityId}` } },
        upsert: true,
      },
    })));
    return { message: '布局已更新', count: positions.length };
  }

  async updateGraphSettings(projectId: string, dto: UpdateGraphSettingsDto) {
    await this.ensureProject(projectId);
    await this.settings.updateOne(
      { projectId }, { $set: dto, $setOnInsert: { _id: projectId, projectId } }, { upsert: true, runValidators: true },
    );
    return { message: '图谱设置已更新' };
  }

  private async getRelation(projectId: string, relationId: string) {
    const relation = await this.relations.findOne({ _id: relationId, projectId }).lean().exec() as PlainRelation | null;
    if (!relation) throw new NotFoundException('关系不存在');
    return this.toRelation(relation);
  }

  private toEntity(entity: PlainEntity) {
    const { _id, teamType, ...rest } = entity;
    return { id: _id, ...rest, ...(entity.entityType === 'team' ? { type: teamType || '' } : {}) };
  }

  private toRelation(relation: PlainRelation) {
    const { _id, sourceEntityId, targetEntityId, ...rest } = relation;
    return { id: _id, sourceId: sourceEntityId, targetId: targetEntityId, ...rest };
  }

  private buildEntity(projectId: string, entityId: string, entityType: EntityType, dto: EntityMutationDto) {
    return {
      _id: entityId, projectId, entityType, revision: 1,
      name: dto.name!.trim(), icon: entityType === 'device' ? undefined : dto.icon || 'AppstoreOutlined',
      ...this.buildEntityPatch(entityType, dto),
    };
  }

  private buildEntityPatch(entityType: EntityType, dto: EntityMutationDto) {
    const common = this.pick(dto, ['name', 'color', 'description', 'sort'] as const);
    const icon = entityType === 'device' ? {} : this.pick(dto, ['icon'] as const);
    const typed = entityType === 'project' ? this.pick(dto, ['shortName', 'address'] as const)
      : entityType === 'team' ? { ...this.pick(dto, ['parentId'] as const), ...(dto.type !== undefined ? { teamType: dto.type } : {}) }
      : entityType === 'position' ? this.pick(dto, ['teamId'] as const)
      : entityType === 'person' ? this.pick(dto, ['phone', 'avatar'] as const)
      : entityType === 'deviceType' ? this.pick(dto, ['category'] as const)
      : entityType === 'device' ? this.pick(dto, ['deviceTypeId', 'code'] as const)
      : {};
    return { ...common, ...icon, ...typed };
  }

  private pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Partial<Pick<T, K>> {
    return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as Partial<Pick<T, K>>;
  }

  private async syncManagedRelations(projectId: string, entity: PlainEntity, dto: EntityMutationDto, session: ClientSession) {
    if (entity.entityType === 'team') {
      await this.upsertManagedRelation(projectId, projectId, entity._id, 'contains', '包含团队', session);
    }
    if (entity.entityType === 'position') {
      await this.upsertManagedRelation(projectId, projectId, entity._id, 'contains', '设置岗位', session);
    }
    if (entity.entityType === 'area') {
      await this.upsertManagedRelation(projectId, projectId, entity._id, 'covers', '覆盖区域', session);
    }
    if (entity.entityType === 'person' && dto.positionIds !== undefined) {
      if (!dto.positionIds.length) throw new BadRequestException('人员必须至少属于一个岗位');
      const positions = await this.entities.find({ projectId, _id: { $in: dto.positionIds }, entityType: 'position' }).session(session).lean().exec();
      if (positions.length !== new Set(dto.positionIds).size) throw new BadRequestException('包含无效或重复的岗位');
      await this.relations.deleteMany({ projectId, sourceEntityId: entity._id, relationType: 'holds_position' }).session(session);
      await this.relations.insertMany(dto.positionIds.map((positionId, index) => ({
        _id: `assignment-${randomUUID()}`, projectId, sourceEntityId: entity._id, targetEntityId: positionId,
        relationType: 'holds_position', label: '担任', sort: index, revision: 1,
      })), { session });
    } else if (entity.entityType === 'person') {
      const count = await this.relations.countDocuments({ projectId, sourceEntityId: entity._id, relationType: 'holds_position' }).session(session);
      if (!count) throw new BadRequestException('人员必须至少属于一个岗位');
    }
    if (entity.entityType === 'device') {
      if (!entity.deviceTypeId) throw new BadRequestException('设备必须选择设备类型');
      const deviceType = await this.entities.findOne({ _id: entity.deviceTypeId, projectId, entityType: 'deviceType' }).session(session).lean().exec() as PlainEntity | null;
      if (!deviceType) throw new BadRequestException('设备类型不存在');
      await this.relations.deleteMany({ projectId, sourceEntityId: entity._id, relationType: 'installed_in' }).session(session);
      if (deviceType.category === 'fixed') {
        if (!dto.areaId) throw new BadRequestException('固定设备必须选择安装区域');
        const area = await this.entities.exists({ _id: dto.areaId, projectId, entityType: 'area' }).session(session);
        if (!area) throw new BadRequestException('安装区域不存在');
        await this.upsertManagedRelation(projectId, entity._id, dto.areaId, 'installed_in', '安装于', session);
      } else if (dto.areaId) {
        throw new BadRequestException('只有固定设备可以安装到区域');
      }
    }
    if (entity.entityType === 'product' && dto.parentProductId !== undefined) {
      await this.relations.deleteMany({ projectId, targetEntityId: entity._id, relationType: 'contains' }).session(session);
      if (dto.parentProductId) {
        if (dto.parentProductId === entity._id) throw new BadRequestException('系统不能包含自身');
        const parent = await this.entities.exists({ _id: dto.parentProductId, projectId, entityType: 'product' }).session(session);
        if (!parent) throw new BadRequestException('上级系统不存在');
        await this.upsertManagedRelation(projectId, dto.parentProductId, entity._id, 'contains', '集成子系统', session);
      }
    }
  }

  private async upsertManagedRelation(projectId: string, sourceId: string, targetId: string, relationType: RelationType, label: string, session: ClientSession) {
    await this.relations.updateOne(
      { projectId, sourceEntityId: sourceId, targetEntityId: targetId, relationType },
      { $setOnInsert: { _id: `relation-${randomUUID()}`, projectId, sourceEntityId: sourceId, targetEntityId: targetId, relationType, label, sort: 0, revision: 1 } },
      { upsert: true, session },
    );
  }

  private async validateRelation(projectId: string, sourceId: string, targetId: string, relationType: RelationType) {
    if (sourceId === targetId) throw new BadRequestException('关系源和目标不能相同');
    const rows = await this.entities.find({ projectId, _id: { $in: [sourceId, targetId] } }).lean().exec() as PlainEntity[];
    if (rows.length !== 2) throw new BadRequestException('关系端点不存在或不属于当前项目');
    const source = rows.find(row => row._id === sourceId)!;
    const target = rows.find(row => row._id === targetId)!;
    if (source.entityType === 'person' || target.entityType === 'person') {
      const other = source.entityType === 'person' ? target.entityType : source.entityType;
      if (other !== 'position' && other !== 'device') throw new BadRequestException('人员只能关联岗位或设备');
    }
    if (relationType === 'holds_position' && !(source.entityType === 'person' && target.entityType === 'position')) {
      throw new BadRequestException('担任关系必须由人员指向岗位');
    }
    if (relationType === 'installed_in') {
      if (!(source.entityType === 'device' && target.entityType === 'area')) throw new BadRequestException('安装关系必须由设备指向区域');
      const type = await this.entities.findOne({ _id: source.deviceTypeId, projectId, entityType: 'deviceType' }).lean().exec() as PlainEntity | null;
      if (type?.category !== 'fixed') throw new BadRequestException('只有固定设备可以安装到区域');
      const existing = await this.relations.findOne({ projectId, sourceEntityId: sourceId, relationType: 'installed_in', targetEntityId: { $ne: targetId } }).lean().exec();
      if (existing) throw new ConflictException('固定设备只能安装到一个区域');
    }
    if (relationType === 'covers' && !(source.entityType === 'project' && target.entityType === 'area')) {
      throw new BadRequestException('覆盖关系必须由项目指向区域');
    }
    if (relationType === 'contains') {
      const validProjectStructure = source.entityType === 'project' && ['team', 'position'].includes(target.entityType);
      const validProductStructure = source.entityType === 'product' && target.entityType === 'product';
      if (!validProjectStructure && !validProductStructure) throw new BadRequestException('包含关系端点类型无效');
      if (validProductStructure) await this.ensureNoProductCycle(projectId, sourceId, targetId);
    }
  }

  private async validateEntityStructure(projectId: string, entity: PlainEntity, session: ClientSession) {
    if (entity.entityType === 'team' && entity.parentId) {
      if (entity.parentId === entity._id) throw new BadRequestException('团队不能以自身作为上级');
      const teams = await this.entities.find({ projectId, entityType: 'team' }).session(session).lean().exec() as PlainEntity[];
      const parent = teams.find(team => team._id === entity.parentId);
      if (!parent) throw new BadRequestException('上级团队不存在');
      const index = new Map(teams.map(team => [team._id, team]));
      let cursor: PlainEntity | undefined = parent;
      while (cursor?.parentId) {
        if (cursor.parentId === entity._id) throw new BadRequestException('团队层级不能形成循环');
        cursor = index.get(cursor.parentId);
      }
    }
    if (entity.entityType === 'position' && entity.teamId) {
      const team = await this.entities.exists({ _id: entity.teamId, projectId, entityType: 'team' }).session(session);
      if (!team) throw new BadRequestException('所属团队不存在');
    }
  }

  private async ensureNoProductCycle(projectId: string, sourceId: string, targetId: string) {
    const relations = await this.relations.find({ projectId, relationType: 'contains' }).lean().exec() as PlainRelation[];
    const next = new Map<string, string[]>();
    for (const relation of relations) next.set(relation.sourceEntityId, [...(next.get(relation.sourceEntityId) || []), relation.targetEntityId]);
    const pending = [targetId];
    const visited = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === sourceId) throw new BadRequestException('系统包含关系不能形成循环');
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(next.get(current) || []));
    }
  }

  private async ensureProject(projectId: string) {
    const project = await this.entities.exists({ _id: projectId, projectId, entityType: 'project' });
    if (!project) throw new NotFoundException('项目不存在');
  }

  private async ensureEntity(projectId: string, entityId: string) {
    const entity = await this.entities.exists({ _id: entityId, projectId });
    if (!entity) throw new NotFoundException('实体不存在');
  }
}
